from collections.abc import Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings


pool = ConnectionPool(
    conninfo=str(get_settings().database_url),
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=False,
)


def open_pool() -> None:
    pool.open(wait=True)


def close_pool() -> None:
    pool.close()


def connection() -> Iterator[Connection]:
    with pool.connection() as conn:
        yield conn


def database_ready() -> bool:
    try:
        with pool.connection() as conn:
            return conn.execute("SELECT 1 AS connected").fetchone()["connected"] == 1
    except Exception:
        return False
