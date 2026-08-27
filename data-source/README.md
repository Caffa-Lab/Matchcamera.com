# Data source

Place the master Excel workbook here when rebuilding `public/data/products.json`.

Expected sheet: `Products`

```bash
pip install openpyxl
python scripts/excel_to_json.py data-source/products.xlsx public/data/products.json
```

Do not put private credentials or API keys in Excel or JSON files committed to GitHub.
