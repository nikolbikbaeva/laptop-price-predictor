"""Shared helpers: paths, loading, cleaning and feature engineering.

Every script imports from here, so the EDA, the training and the
predictions all clean the data and build the features in the same way.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "dat" / "laptops" / "laptop_scrap_data.csv"
MODELS = ROOT / "models" / "laptops"
REPORTS = ROOT / "reports"

RANDOM_STATE = 42
TEST_SIZE = 0.2

# Numeric columns used as they are.
NUMERIC = [
    "Inches", "X_res", "Y_res", "ppi", "TouchScreen", "Ips", "Dedicated_Gpu",
    "Ram_GB", "Weight_kg", "SSD", "HHD",
]
# Columns we create from free text (see cpu_features / gpu_features).
ENGINEERED = ["cpu_tier", "rtx", "rtx_gen"]
# Raw columns a new laptop must have to get a prediction.
REQUIRED_INPUT = ["Company", "Cpu", "Gpu"] + NUMERIC

# Short meaning of every column in the original file (see dat/laptops/data_description.txt).
COLUMN_GUIDE = {
    "Company": "Brand",
    "TypeName": "Laptop model name; one model can appear with several configurations",
    "Inches": "Screen diagonal in inches",
    "ScreenResolution": "Screen resolution as text",
    "Cpu": "Processor name (free text)",
    "Gpu": "Graphics name (free text)",
    "OpSys": "Operating system",
    "TouchScreen": "1 = touch screen",
    "Ips": "1 = IPS panel (better viewing angles)",
    "X_res": "Horizontal pixels",
    "Y_res": "Vertical pixels",
    "ppi": "Pixels per inch (screen sharpness)",
    "Dedicated_Gpu": "1 = separate graphics card",
    "Ram_GB": "Memory in GB",
    "Weight_kg": "Weight in kg; 0 means missing",
    "SSD": "SSD storage in GB",
    "HHD": "Hard-disk storage in GB",
    "Storage_Type": "Storage summary",
    "Total_Storage_GB": "SSD + HDD in GB; 0 means missing",
    "Storage_Category": "Storage size group",
    "Price": "Target: listed price (currency not labelled, treated as USD)",
}
USED_BY_MODEL = {
    **{c: "yes" for c in NUMERIC},
    "Company": "yes (one-hot)",
    "Cpu": "yes (vendor + tier)",
    "Gpu": "yes (RTX class + generation)",
    "Price": "target",
    "TypeName": "grouping for the unseen-model check",
    "Total_Storage_GB": "cleaning only",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_raw(path: Path = DATA) -> pd.DataFrame:
    """Read the CSV exactly as downloaded."""
    return pd.read_csv(path)


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Remove empty rows and impossible values. Returns the data and a log."""
    log = {"raw_rows": int(len(df))}
    df = df.dropna(how="all")
    log["empty_rows_removed"] = log["raw_rows"] - int(len(df))
    log["weight_zero"] = int((df.Weight_kg <= 0).sum())
    log["storage_zero"] = int((df.Total_Storage_GB <= 0).sum())
    df = df[(df.Weight_kg > 0) & (df.Total_Storage_GB > 0)].copy()
    log["rows_used"] = int(len(df))
    return df, log


def cpu_features(name) -> tuple[str, int]:
    """Turn a CPU name into (vendor, tier). Tier 1 = basic ... 9 = top."""
    c = str(name).lower()
    if "apple" in c:
        vendor = "apple"
    elif "ryzen" in c or "amd" in c:
        vendor = "amd"
    elif "snapdragon" in c:
        vendor = "qualcomm"
    elif re.search("intel|core|celeron|pentium", c):
        vendor = "intel"
    else:
        vendor = "other"
    m = re.search(r"(?:ultra|core|ryzen(?: ai)?|i)\s*x?([3579])\b", c)
    tier = int(m.group(1)) if m else 5  # i7 / Ultra 7 / Ryzen 7 -> 7
    if vendor == "apple":
        tier = 9 if "max" in c else 7 if "pro" in c else 5
    if re.search(r"celeron|pentium|n100|n150|n200|athlon|mediatek", c):
        tier = 1
    return vendor, tier


def gpu_features(name) -> tuple[int, int]:
    """NVIDIA RTX 4060 -> (class 60, generation 4). No RTX -> (0, 0)."""
    m = re.search(r"rtx\s*(?:pro\s*)?(\d{4})", str(name).lower())
    if not m:
        return 0, 0
    number = int(m.group(1))
    return number % 100, number // 1000


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["cpu_v"], df["cpu_tier"] = zip(*df.Cpu.map(cpu_features))
    df["rtx"], df["rtx_gen"] = zip(*df.Gpu.map(gpu_features))
    return df


def design_matrix(df: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
    """Numbers the models can read: numeric columns + one-hot brand and CPU vendor.

    Pass the training `columns` when predicting, so new data gets the same
    columns in the same order (unknown brands simply become all zeros).
    """
    df = add_features(df)
    X = pd.concat(
        [df[NUMERIC + ENGINEERED], pd.get_dummies(df.Company), pd.get_dummies(df.cpu_v)],
        axis=1,
    ).astype(float)
    if columns is not None:
        X = X.reindex(columns=columns, fill_value=0.0)
    return X


def target(df: pd.DataFrame) -> np.ndarray:
    """We predict log(price): in expensive laptops don't dominate the errors."""
    return np.log(df.Price.values)
