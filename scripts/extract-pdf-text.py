#!/usr/bin/env python3

import json
import re
import sys

import pdfplumber


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法：extract-pdf-text.py /path/to/questions.pdf [start] [limit]")
    start_question = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None
    limit = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
    lines = []
    selected_questions = 0
    collecting = start_question is None
    pages_scanned = 0
    with pdfplumber.open(sys.argv[1]) as document:
        for page_number, page in enumerate(document.pages, start=1):
            pages_scanned = page_number
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            for index, raw_line in enumerate(text.splitlines()):
                clean = re.sub(r"\s+", " ", raw_line).strip()
                marker = re.match(r"^Question\s*#\s*(\d+)", clean, re.I)
                if marker:
                    question_number = int(marker.group(1))
                    if start_question is not None and question_number < start_question:
                        collecting = False
                        continue
                    if limit is not None and selected_questions >= limit:
                        json.dump({"lines": lines, "pagesScanned": pages_scanned}, sys.stdout, ensure_ascii=False)
                        return
                    collecting = True
                    selected_questions += 1
                if not collecting:
                    continue
                is_header = re.match(r"^Exam AWS Certified Solutions Architect", clean, re.I)
                is_watermark = clean.startswith("<专业帮考服务")
                if clean and not is_header and not is_watermark:
                    lines.append({"page": page_number, "y": -index, "text": clean})
    json.dump({"lines": lines, "pagesScanned": pages_scanned}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
