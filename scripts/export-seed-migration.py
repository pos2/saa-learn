#!/usr/bin/env python3
"""Export the durable SAA question bank into a chunked D1 seed migration."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


TABLES = {
    "questions": ["id", "original_text", "title", "answer", "summary", "status", "mastery", "familiarity", "model", "prompt_version", "created_at", "updated_at"],
    "tags": ["id", "name", "normalized_name", "kind", "status", "created_at"],
    "knowledge_points": ["id", "name", "normalized_name", "description", "exam_cue", "status", "created_at", "updated_at"],
    "question_options": ["id", "question_id", "label", "content", "explanation", "is_correct", "sort_order"],
    "question_tags": ["question_id", "tag_id"],
    "question_knowledge_points": ["question_id", "knowledge_point_id", "sort_order"],
    "app_settings": ["key", "value", "updated_at"],
}


def literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return f"X'{value.hex()}'"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("\x00", "").replace("'", "''") + "'"


def export(database: Path, output: Path) -> None:
    connection = sqlite3.connect(database)
    max_statement_bytes = 60_000
    counts: dict[str, int] = {}
    with output.open("w", encoding="utf-8") as target:
        target.write("-- Generated from the local SAA Learn database. AI call logs are intentionally omitted.\n")
        for table, columns in TABLES.items():
            quoted_columns = ", ".join(f'"{column}"' for column in columns)
            prefix = f'INSERT OR IGNORE INTO "{table}" ({quoted_columns}) VALUES\n'
            rows = connection.execute(f'SELECT {quoted_columns} FROM "{table}"').fetchall()
            counts[table] = len(rows)
            batch: list[str] = []
            batch_bytes = len(prefix.encode())
            for row in rows:
                encoded = "(" + ", ".join(literal(value) for value in row) + ")"
                encoded_bytes = len(encoded.encode("utf-8")) + 2
                if batch and batch_bytes + encoded_bytes > max_statement_bytes:
                    target.write(prefix + ",\n".join(batch) + ";--> statement-breakpoint\n")
                    batch = []
                    batch_bytes = len(prefix.encode())
                batch.append(encoded)
                batch_bytes += encoded_bytes
            if batch:
                target.write(prefix + ",\n".join(batch) + ";--> statement-breakpoint\n")
        target.write("PRAGMA optimize;\n")
    connection.close()
    print(" ".join(f"{table}={count}" for table, count in counts.items()))
    print(f"output={output} bytes={output.stat().st_size}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: export-seed-migration.py DATABASE OUTPUT")
    export(Path(sys.argv[1]), Path(sys.argv[2]))
