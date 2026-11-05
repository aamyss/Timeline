# Roster highlighter

Highlights one officer's cells on a photographed duty-roster table, once per officer, and adds a summary banner.

```
pip install opencv-python-headless pillow numpy
python3 roster_highlight.py photo.jpg table.json out/
```

`table.json` (written by hand or by Claude after reading the photo):

```json
{
  "title": "เวร <month> <year>",
  "file_prefix": "เวร_<month><year>",
  "people": {"A": "<name as printed>", "B": "..."},
  "columns": ["รับแจ้งความ", "รับแจ้งความ", "รับแจ้งความ", "ฝากขัง", "ออนไลน์"],
  "rows": [["A", "B", "C", "D", ""], ...]
}
```

One `rows` entry per day, one code per duty column, `""` for an empty cell. The table is located from its ruled lines (curved fit), so a slightly tilted or bent photo still lines up. Check the output images before sending.

Font: Loma Bold from TLWG (fonts-tlwg), GPL with font exception.
