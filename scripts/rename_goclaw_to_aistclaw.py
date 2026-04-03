"""Repo-wide GoClaw -> Aistclaw rename helper.

Default behavior is a dry run. Use --apply to write file contents and
--rename-paths to also rename files/directories whose names contain the brand.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ANYWHERE_EXCLUDED_DIRS = {
    ".git",
    ".idea",
    ".next",
    ".turbo",
    ".vite",
    "__pycache__",
    "dist",
    "electron-dist",
    "node_modules",
    "release",
    "tmp",
}

ROOT_EXCLUDED_PREFIXES = (
    ("extensions", "backends"),
    ("extensions", "plugins"),
    ("src", "backend", "bin"),
)

TEXT_EXTENSIONS = {
    ".bat",
    ".cjs",
    ".cmd",
    ".conf",
    ".css",
    ".csv",
    ".env",
    ".gitignore",
    ".gitattributes",
    ".go",
    ".graphql",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsonc",
    ".jsx",
    ".md",
    ".mjs",
    ".proto",
    ".ps1",
    ".py",
    ".scss",
    ".sh",
    ".sql",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

TEXT_FILENAMES = {
    ".editorconfig",
    ".npmrc",
    "Dockerfile",
    "Makefile",
    "go.mod",
    "go.sum",
}

REPLACEMENTS = (
    ("GoClaw", "Aistclaw"),
    ("GOCLAW", "AISTCLAW"),
    ("goclaw", "aistclaw"),
)


@dataclass(frozen=True)
class FileChange:
    path: Path
    replacements: int


@dataclass(frozen=True)
class PathChange:
    old_path: Path
    new_path: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rename GoClaw branding across the repo.")
    parser.add_argument("--root", default=".", help="Repository root to process.")
    parser.add_argument("--apply", action="store_true", help="Write file content changes.")
    parser.add_argument(
        "--rename-paths",
        action="store_true",
        help="Rename files and directories whose names contain the brand.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=40,
        help="Maximum number of sample entries to print per section.",
    )
    return parser.parse_args()


def is_root_excluded(parts: tuple[str, ...]) -> bool:
    return any(parts[: len(prefix)] == prefix for prefix in ROOT_EXCLUDED_PREFIXES)


def should_skip_path(root: Path, path: Path) -> bool:
    try:
        rel_parts = path.relative_to(root).parts
    except ValueError:
        return True
    if not rel_parts:
        return False
    if any(part in ANYWHERE_EXCLUDED_DIRS for part in rel_parts):
        return True
    return is_root_excluded(rel_parts)


def is_text_file(path: Path) -> bool:
    if path.name in TEXT_FILENAMES:
        return True
    return path.suffix.lower() in TEXT_EXTENSIONS


def apply_replacements(text: str) -> tuple[str, int]:
    updated = text
    replacement_count = 0
    for old, new in REPLACEMENTS:
        count = updated.count(old)
        if count:
            updated = updated.replace(old, new)
            replacement_count += count
    return updated, replacement_count


def iter_text_files(root: Path, script_path: Path) -> Iterable[Path]:
    for current, dirnames, filenames in os.walk(root):
        current_path = Path(current)
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if not should_skip_path(root, current_path / dirname)
        ]
        for filename in filenames:
            file_path = current_path / filename
            if file_path.resolve() == script_path:
                continue
            if should_skip_path(root, file_path):
                continue
            if is_text_file(file_path):
                yield file_path


def collect_file_changes(root: Path, script_path: Path, apply: bool) -> list[FileChange]:
    changes: list[FileChange] = []
    for file_path in iter_text_files(root, script_path):
        try:
            original = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        updated, count = apply_replacements(original)
        if count == 0 or updated == original:
            continue
        if apply:
            file_path.write_text(updated, encoding="utf-8")
        changes.append(FileChange(path=file_path, replacements=count))
    return changes


def collect_path_changes(root: Path, script_path: Path) -> list[PathChange]:
    paths: list[Path] = []
    for current, dirnames, filenames in os.walk(root):
        current_path = Path(current)
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if not should_skip_path(root, current_path / dirname)
        ]
        for dirname in dirnames:
            candidate = current_path / dirname
            if candidate.resolve() != script_path:
                paths.append(candidate)
        for filename in filenames:
            candidate = current_path / filename
            if candidate.resolve() != script_path and not should_skip_path(root, candidate):
                paths.append(candidate)

    changes: list[PathChange] = []
    for old_path in sorted(paths, key=lambda item: len(item.parts), reverse=True):
        new_name, _ = apply_replacements(old_path.name)
        if new_name == old_path.name:
            continue
        changes.append(PathChange(old_path=old_path, new_path=old_path.with_name(new_name)))
    return changes


def apply_path_changes(changes: list[PathChange]) -> None:
    for change in changes:
        change.old_path.rename(change.new_path)


def print_section(title: str, items: list[str], limit: int) -> None:
    print(title)
    if not items:
        print("  none")
        return
    for item in items[:limit]:
        print(f"  {item}")
    remaining = len(items) - min(len(items), limit)
    if remaining > 0:
        print(f"  ... {remaining} more")


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    script_path = Path(__file__).resolve()

    if not root.exists():
        raise SystemExit(f"Root path does not exist: {root}")

    file_changes = collect_file_changes(root, script_path, apply=args.apply)
    path_changes = collect_path_changes(root, script_path) if args.rename_paths else []

    print(f"Mode: {'apply' if args.apply else 'dry-run'}")
    print(f"Root: {root}")
    print(f"Files with content changes: {len(file_changes)}")
    print(f"Paths with rename changes: {len(path_changes)}")
    print()

    print_section(
        "Sample file changes:",
        [
            f"{change.path.relative_to(root)} ({change.replacements} replacements)"
            for change in file_changes
        ],
        args.limit,
    )
    print()
    print_section(
        "Sample path changes:",
        [
            f"{change.old_path.relative_to(root)} -> {change.new_path.relative_to(root)}"
            for change in path_changes
        ],
        args.limit,
    )

    if args.apply and args.rename_paths and path_changes:
        apply_path_changes(path_changes)
        print()
        print("Path renames applied.")
    elif args.apply and args.rename_paths:
        print()
        print("No path renames were needed.")
    elif args.rename_paths:
        print()
        print("Path renames were previewed only. Re-run with --apply to execute them.")

    if not args.apply:
        print()
        print("Dry run only. Re-run with --apply to write file contents.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
