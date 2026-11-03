"""Project storage: one SQLite file, model stored as JSON. Swap for Postgres later."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .model import BuildingModel
from .sample import sample_project

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "archmind.db"


def _connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE IF NOT EXISTS projects ("
        " id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    return conn


class ProjectStore:
    def __init__(self, path: Path = DB_PATH):
        self.path = path
        with _connect(self.path) as conn:
            if conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0:
                self._insert(conn, "sample", sample_project())

    def _insert(self, conn, id: str, model: BuildingModel) -> None:
        conn.execute(
            "INSERT INTO projects (id, name, data, updated_at) VALUES (?, ?, ?, ?)",
            (id, model.name, model.model_dump_json(), _now()),
        )

    def list(self) -> list[dict]:
        with _connect(self.path) as conn:
            rows = conn.execute("SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC")
            return [dict(r) for r in rows]

    def get(self, id: str) -> BuildingModel | None:
        with _connect(self.path) as conn:
            row = conn.execute("SELECT data FROM projects WHERE id = ?", (id,)).fetchone()
        return BuildingModel.model_validate(json.loads(row["data"])) if row else None

    def create(self, model: BuildingModel) -> str:
        id = uuid.uuid4().hex[:12]
        with _connect(self.path) as conn:
            self._insert(conn, id, model)
        return id

    def delete(self, id: str) -> bool:
        with _connect(self.path) as conn:
            return conn.execute("DELETE FROM projects WHERE id = ?", (id,)).rowcount == 1

    def rename(self, id: str, name: str) -> bool:
        model = self.get(id)
        return model is not None and self.save(id, model.model_copy(update={"name": name}))

    def save(self, id: str, model: BuildingModel) -> bool:
        with _connect(self.path) as conn:
            cur = conn.execute(
                "UPDATE projects SET name = ?, data = ?, updated_at = ? WHERE id = ?",
                (model.name, model.model_dump_json(), _now(), id),
            )
        return cur.rowcount == 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
