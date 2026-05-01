#!/usr/bin/env python3
"""
fetch_data.py — Phase 1C data fetcher
Pulls daily + 1h OHLCV from yfinance, caches to Parquet.

Usage:
    python fetch_data.py            # fetch all tickers
    python fetch_data.py AAPL SPY   # fetch specific tickers
"""
import logging
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

# ── Config ────────────────────────────────────────────────────────────────────

TICKERS = [
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META',
    'JPM',  'XOM',  'JNJ',  'WMT',   'V',
    'SPY',  'QQQ',  'IWM',  'DIA',
    'TSLA', 'COIN', 'SOFI', 'PLTR',
    'KO',   'PG',
]

# First full trading day after IPO/listing for short-history tickers.
# Daily fetch will not go earlier than these dates.
IPO_FLOORS: dict[str, date] = {
    'COIN': date(2021, 4, 14),   # Coinbase direct listing
    'SOFI': date(2021, 5, 28),   # SPAC merger → SOFI ticker
    'PLTR': date(2020, 9, 30),   # Palantir direct listing
}

DATA_DIR     = Path(__file__).parent / 'data'
LOOKBACK_YRS = 5
MAX_1H_DAYS  = 730   # yfinance hard cap for 1h history

# ── Helpers ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-8s %(message)s',
    datefmt='%H:%M:%S',
    stream=sys.stdout,
)
log = logging.getLogger(__name__)


def is_fresh(path: Path) -> bool:
    """Return True if parquet exists and its last bar is within 1 trading day of today."""
    if not path.exists():
        return False
    try:
        df = pd.read_parquet(path)
        if df.empty:
            return False
        last_date = pd.Timestamp(df.index[-1]).date()
        today = date.today()
        # Count business days strictly after last_date up to today.
        # bdate_range includes both endpoints, so +1 day on start excludes last_date itself.
        after = pd.bdate_range(last_date + timedelta(days=1), today)
        return len(after) <= 1
    except Exception:
        return False


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize yfinance output to lowercase OHLCV columns, UTC DatetimeIndex.
    Drops dividends/splits columns; drops rows with null close.
    """
    if df.empty:
        return df

    # yf.download multi-level columns: ('Close', 'AAPL') etc. — flatten if present.
    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(1, axis=1)

    rename = {'Open': 'open', 'High': 'high', 'Low': 'low',
               'Close': 'close', 'Volume': 'volume'}
    df = df.rename(columns=rename)
    keep = [c for c in ('open', 'high', 'low', 'close', 'volume') if c in df.columns]
    df = df[keep].copy()

    # Normalize index to UTC-aware DatetimeIndex.
    if df.index.tz is None:
        df.index = df.index.tz_localize('UTC')
    else:
        df.index = df.index.tz_convert('UTC')
    df.index.name = 'datetime'

    df = df.dropna(subset=['close'])
    df = df[df['close'] > 0]
    return df


def fetch_with_retry(ticker_obj: yf.Ticker, start: date, end: date,
                     interval: str, retries: int = 3) -> pd.DataFrame:
    """Call ticker.history() with exponential-backoff retry."""
    for attempt in range(retries):
        try:
            df = ticker_obj.history(
                start=str(start),
                end=str(end),
                interval=interval,
                auto_adjust=True,
                actions=False,
            )
            return df
        except Exception as exc:
            if attempt < retries - 1:
                wait = 2 ** attempt
                log.warning('  %s %s attempt %d failed (%s); retrying in %ds',
                            interval, ticker_obj.ticker, attempt + 1, exc, wait)
                time.sleep(wait)
            else:
                raise


# ── Per-ticker fetch ───────────────────────────────────────────────────────────

def fetch_ticker(sym: str) -> dict:
    """
    Fetch daily + 1h bars for one symbol.
    Returns a summary dict for the final report.
    """
    today        = date.today()
    five_yr_ago  = date(today.year - LOOKBACK_YRS, today.month, today.day)
    ipo_floor    = IPO_FLOORS.get(sym)
    daily_start  = max(five_yr_ago, ipo_floor) if ipo_floor else five_yr_ago
    clipped      = ipo_floor is not None and daily_start > five_yr_ago

    result = {'sym': sym, 'warnings': [], 'daily': None, '1h': None}
    if clipped:
        result['warnings'].append(
            f'daily history clipped to IPO floor {ipo_floor} '
            f'(requested 5yr start was {five_yr_ago})'
        )

    ticker_obj = yf.Ticker(sym)

    # ── Daily ─────────────────────────────────────────────────────────────────
    daily_path = DATA_DIR / f'{sym}_daily.parquet'
    if is_fresh(daily_path):
        df = pd.read_parquet(daily_path)
        result['daily'] = {
            'bars': len(df),
            'start': str(df.index[0].date()),
            'end':   str(df.index[-1].date()),
            'cached': True,
        }
        log.info('  %s daily: %d bars [cached]', sym, len(df))
    else:
        df = fetch_with_retry(ticker_obj, daily_start, today + timedelta(days=1), '1d')
        df = normalize(df)
        if df.empty:
            result['warnings'].append('daily: yfinance returned empty DataFrame')
        else:
            df.to_parquet(daily_path)
            result['daily'] = {
                'bars':   len(df),
                'start':  str(df.index[0].date()),
                'end':    str(df.index[-1].date()),
                'cached': False,
            }
            log.info('  %s daily: %d bars  %s..%s',
                     sym, len(df), df.index[0].date(), df.index[-1].date())

    # ── 1h ────────────────────────────────────────────────────────────────────
    # yfinance enforces 730 days measured from the live UTC timestamp, not midnight.
    # Using 729 days back (from now) guarantees we stay inside the window all day.
    now_utc  = datetime.now(timezone.utc)
    h1_floor = (now_utc - timedelta(days=MAX_1H_DAYS - 1)).date()
    h1_start = max(h1_floor, daily_start)
    h1_path    = DATA_DIR / f'{sym}_1h.parquet'
    if is_fresh(h1_path):
        df = pd.read_parquet(h1_path)
        result['1h'] = {
            'bars':   len(df),
            'start':  str(df.index[0].date()),
            'end':    str(df.index[-1].date()),
            'cached': True,
        }
        log.info('  %s 1h:    %d bars [cached]', sym, len(df))
    else:
        try:
            df = fetch_with_retry(ticker_obj, h1_start, today + timedelta(days=1), '1h')
            df = normalize(df)
            if df.empty:
                result['warnings'].append('1h: yfinance returned empty DataFrame')
            else:
                df.to_parquet(h1_path)
                result['1h'] = {
                    'bars':   len(df),
                    'start':  str(df.index[0].date()),
                    'end':    str(df.index[-1].date()),
                    'cached': False,
                }
                log.info('  %s 1h:    %d bars  %s..%s',
                         sym, len(df), df.index[0].date(), df.index[-1].date())
        except Exception as exc:
            result['warnings'].append(f'1h fetch failed: {exc}')
            log.warning('  %s 1h: fetch failed — %s', sym, exc)

    return result


# ── Summary printer ───────────────────────────────────────────────────────────

def print_summary(summaries: list[dict]) -> None:
    W = 76
    print()
    print('=' * W)
    print(f'{"APEX BACKTESTER — PHASE 1C DATA FETCH SUMMARY":^{W}}')
    print('=' * W)
    print(f'{"TICKER":<6}  {"TF":<5}  {"BARS":>6}  {"DATE RANGE":<27}  STATUS')
    print('-' * W)

    for s in summaries:
        sym = s['sym']
        for tf in ('daily', '1h'):
            info = s.get(tf)
            if info:
                tag    = '[cached]'  if info['cached'] else '[fetched]'
                rng    = f'{info["start"]} .. {info["end"]}'
                print(f'{sym:<6}  {tf:<5}  {info["bars"]:>6}  {rng:<27}  {tag}')
            else:
                print(f'{sym:<6}  {tf:<5}  {"--":>6}  {"no data":<27}  [MISSING]')
        for w in s['warnings']:
            print(f'         WARN: {w}')

    print('-' * W)
    total_d = sum(s['daily']['bars'] for s in summaries if s.get('daily'))
    total_h = sum(s['1h']['bars']    for s in summaries if s.get('1h'))
    print(f'Total: {total_d:,} daily bars + {total_h:,} 1h bars = {total_d + total_h:,} bars')
    print('=' * W)
    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    targets = sys.argv[1:] if len(sys.argv) > 1 else TICKERS
    invalid = [t for t in targets if t not in TICKERS]
    if invalid:
        log.error('Unknown tickers: %s. Valid: %s', invalid, TICKERS)
        sys.exit(1)

    log.info('Fetching %d tickers: %s', len(targets), ' '.join(targets))
    log.info('Data dir: %s', DATA_DIR)

    summaries = []
    for sym in targets:
        log.info('--- %s ---', sym)
        try:
            s = fetch_ticker(sym)
        except Exception as exc:
            log.error('FATAL error fetching %s: %s', sym, exc)
            s = {'sym': sym, 'warnings': [f'FATAL: {exc}'], 'daily': None, '1h': None}
        summaries.append(s)
        time.sleep(0.3)   # polite pacing between tickers

    print_summary(summaries)


if __name__ == '__main__':
    main()
