"""Predict prices for new laptops with the saved best model.

The input CSV needs these columns (same names as the dataset):
  Company, Cpu, Gpu, Inches, X_res, Y_res, ppi, TouchScreen, Ips,
  Dedicated_Gpu, Ram_GB, Weight_kg, SSD, HHD
Extra columns are kept in the output but not used.

    python scripts/predict_prices.py \
      --input models/laptops/example_laptops.csv \
      --output reports/example_predictions.csv
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from common import MODELS, REPORTS, REQUIRED_INPUT, design_matrix


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, default=MODELS / "example_laptops.csv")
    ap.add_argument("--output", type=Path, default=REPORTS / "example_predictions.csv")
    ap.add_argument("--model", type=Path, default=MODELS / "best_model.joblib")
    args = ap.parse_args()

    df = pd.read_csv(args.input)
    missing = [c for c in REQUIRED_INPUT if c not in df.columns]
    if missing:
        sys.exit(f"Missing columns in {args.input}: {', '.join(missing)}")

    saved = joblib.load(args.model)
    X = design_matrix(df, columns=saved["columns"])
    df["predicted_price"] = np.exp(saved["model"].predict(X)).round(0)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, index=False)
    for row in df.itertuples():
        print(f"{row.Company:10s} {row.Ram_GB:>4.0f} GB RAM  {row.SSD:>5.0f} GB SSD  ->  {row.predicted_price:,.0f}")
    print(f"Saved {args.output} ({saved['name']})")


if __name__ == "__main__":
    main()
