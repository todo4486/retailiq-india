"""
EXTRACT stage: read the source CSV with Pandas.

Every column is read as text on purpose. Type conversion belongs to Transform, where
each value that fails to convert can be counted rather than silently lost.
"""
import pandas as pd

CHUNK_ROWS = 50_000


def _read(path, encoding, on_progress):
    chunks, total = [], 0
    for chunk in pd.read_csv(path, dtype=str, encoding=encoding, chunksize=CHUNK_ROWS, skipinitialspace=True):
        chunks.append(chunk)
        total += len(chunk)
        if on_progress:
            on_progress(total)
    if total == 0:
        raise ValueError("The CSV file has no data rows.")
    return pd.concat(chunks, ignore_index=True)


def extract_csv(path, on_progress=None):
    try:
        return _read(path, "utf-8", on_progress)
    except pd.errors.EmptyDataError:
        raise ValueError("The CSV file has no data rows.")
    except UnicodeDecodeError:
        # Retail exports from Excel are often Windows-1252 rather than UTF-8.
        return _read(path, "latin-1", on_progress)
