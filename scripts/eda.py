#!/usr/bin/env python3
"""Exploratory data analysis of the laptop dataset -> one offline HTML report.

    python scripts/eda.py
    python scripts/eda.py --input dat/laptops/laptop_scrap_data.csv --output reports/laptops_eda.html

The report embeds its charts and the Plotly library, so it works offline and
can be shared as a single file.
"""
from __future__ import annotations

import argparse
import platform
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import plotly
import plotly.graph_objects as go
from jinja2 import Environment, FileSystemLoader, select_autoescape
from plotly.offline import get_plotlyjs

from common import COLUMN_GUIDE, DATA, REPORTS, USED_BY_MODEL, add_features, clean, load_raw

TEMPLATES = Path(__file__).resolve().parent / "templates"
ACCENT, TEAL, AMBER = "#5b3fd6", "#0f7f6f", "#b5660f"


def render_env() -> Environment:
    return Environment(loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape(["html", "j2"]))


def versions() -> dict:
    out = {"python": platform.python_version(), "pandas": pd.__version__, "plotly": plotly.__version__}
    try:
        import sklearn
        out["scikit-learn"] = sklearn.__version__
    except ImportError:
        pass
    return out


def to_html(fig: go.Figure, height: int = 420) -> str:
    fig.update_layout(height=height, template="plotly_white", margin=dict(l=60, r=20, t=50, b=50),
                      font=dict(family="system-ui, sans-serif", size=13), title_x=0)
    return fig.to_html(full_html=False, include_plotlyjs=False, config={"displaylogo": False, "responsive": True})


def box_by(df: pd.DataFrame, col: str, title: str, order=None, labels=None) -> str:
    order = order if order is not None else sorted(df[col].unique())
    fig = go.Figure()
    for v in order:
        sub = df.loc[df[col] == v, "Price"]
        name = labels.get(v, str(v)) if labels else str(v)
        fig.add_trace(go.Box(y=sub, name=f"{name} ({len(sub)})", marker_color=ACCENT, boxpoints="outliers", showlegend=False))
    fig.update_layout(title=title, yaxis_title="Price")
    return to_html(fig)


def build_charts(df: pd.DataFrame) -> dict:
    charts = {}
    fig = go.Figure(go.Histogram(x=df.Price, nbinsx=60, marker_color=ACCENT))
    fig.add_vline(x=df.Price.median(), line_dash="dash", line_color=TEAL, annotation_text="median")
    fig.add_vline(x=df.Price.mean(), line_dash="dot", line_color=AMBER, annotation_text="mean", annotation_position="bottom right")
    fig.update_layout(title="Price distribution", xaxis_title="Price", yaxis_title="Laptops")
    charts["price_hist"] = to_html(fig)

    fig = go.Figure(go.Histogram(x=np.log(df.Price), nbinsx=60, marker_color=TEAL))
    fig.update_layout(title="log(price) distribution — what the models learn", xaxis_title="log(Price)", yaxis_title="Laptops")
    charts["log_hist"] = to_html(fig, 360)

    counts = df.Company.value_counts().sort_values()
    fig = go.Figure(go.Bar(x=counts.values, y=counts.index, orientation="h", marker_color=ACCENT))
    fig.update_layout(title="Laptops per brand", xaxis_title="Laptops")
    charts["brand_count"] = to_html(fig, 520)

    order = df.groupby("Company").Price.median().sort_values(ascending=False).index
    charts["brand_box"] = box_by(df, "Company", "Price by brand (sorted by median)", order=order)
    charts["ram_box"] = box_by(df, "Ram_GB", "Price by memory (RAM, GB)")
    charts["ssd_box"] = box_by(df[df.SSD > 0], "SSD", "Price by SSD size (GB)")
    charts["gpu_box"] = box_by(df, "Dedicated_Gpu", "Price with and without a dedicated graphics card",
                               labels={0: "No dedicated GPU", 1: "Dedicated GPU"})
    charts["cpu_box"] = box_by(df, "cpu_tier", "Price by CPU tier (1 = basic … 9 = top)")

    num = ["Ram_GB", "SSD", "Dedicated_Gpu", "cpu_tier", "rtx", "rtx_gen", "ppi", "X_res", "Y_res", "Inches",
           "Weight_kg", "TouchScreen", "Ips", "HHD"]
    corr = df[num].corrwith(np.log(df.Price)).sort_values()
    fig = go.Figure(go.Bar(x=corr.values, y=corr.index, orientation="h",
                           marker_color=[TEAL if v > 0 else AMBER for v in corr.values],
                           hovertemplate="%{y}: %{x:.2f}<extra></extra>"))
    fig.update_layout(title="Correlation with log(price)", xaxis=dict(range=[-1, 1]))
    charts["corr"] = to_html(fig, 480)

    fig = go.Figure(go.Scatter(
        x=df.Ram_GB + np.random.default_rng(0).uniform(-0.8, 0.8, len(df)), y=df.Price, mode="markers",
        marker=dict(color=df.Dedicated_Gpu.map({0: ACCENT, 1: AMBER}), opacity=0.45, size=6),
        text=df.TypeName, hovertemplate="%{text}<br>RAM %{x:.0f} GB · price %{y:,.0f}<extra></extra>"))
    fig.update_layout(title="Every laptop: RAM vs price (orange = dedicated GPU)", xaxis_title="RAM (GB, jittered)", yaxis_title="Price")
    charts["scatter"] = to_html(fig, 460)
    return charts


def column_table(raw: pd.DataFrame) -> list[dict]:
    rows = []
    for c in raw.columns:
        s = raw[c].dropna()
        missing = int(raw[c].isna().sum())
        if c in ("Weight_kg", "Total_Storage_GB"):
            missing += int((raw[c] == 0).sum())
        rows.append({
            "name": c, "type": "number" if pd.api.types.is_numeric_dtype(raw[c]) else "text",
            "missing": missing, "distinct": int(s.nunique()), "example": str(s.iloc[0])[:40],
            "meaning": COLUMN_GUIDE.get(c, ""), "used": USED_BY_MODEL.get(c, "no"),
        })
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, default=DATA, help="laptop CSV with the original column names")
    ap.add_argument("--output", type=Path, default=REPORTS / "laptops_eda.html", help="where to write the HTML report")
    args = ap.parse_args()

    raw = load_raw(args.input)
    df, log = clean(raw)
    df = add_features(df)
    p = df.Price
    dupes = int(df.duplicated(subset=[c for c in df.columns if c != "Price"]).sum())
    s = dict(raw_rows=log["raw_rows"], rows_used=log["rows_used"], brands=df.Company.nunique(), models=df.TypeName.nunique(),
             median=p.median(), mean=p.mean(), min=p.min(), max=p.max(), q1=p.quantile(.25), q3=p.quantile(.75))

    ram_med = df.groupby("Ram_GB").Price.median()
    gpu_med = df.groupby("Dedicated_Gpu").Price.median()
    top2 = df.Company.value_counts().head(2)
    findings = [
        ("Memory drives price", f"Median price goes from {ram_med.iloc[0]:,.0f} with {int(ram_med.index[0])} GB RAM "
                                f"to {ram_med.iloc[-1]:,.0f} with {int(ram_med.index[-1])} GB."),
        ("Graphics cards add a premium", f"Laptops with a dedicated GPU have a median price of {gpu_med[1]:,.0f}, "
                                         f"versus {gpu_med[0]:,.0f} without."),
        ("Two brands dominate", f"{top2.index[0]} ({top2.iloc[0]}) and {top2.index[1]} ({top2.iloc[1]}) are "
                                f"{top2.sum() / len(df):.0%} of all laptops."),
        ("Clean, but repetitive", f"Only {log['empty_rows_removed'] + log['weight_zero'] + log['storage_zero']} problem rows, but {s['models']} models for {s['rows_used']:,} rows: "
                                  f"many rows are the same laptop with different memory or storage."),
    ]
    quality = [
        ("Completely empty rows", log["empty_rows_removed"], "Removed"),
        ("Weight = 0 kg (impossible)", log["weight_zero"], "Left out"),
        ("Total storage = 0 GB (impossible)", log["storage_zero"], "Left out"),
        ("Rows identical except for price", dupes, "Kept (same laptop listed twice)"),
        ("Rows used for analysis and modeling", log["rows_used"], "—"),
    ]

    html = render_env().get_template("laptops_eda.html.j2").render(
        title="Laptop prices · Exploratory data analysis",
        description="Exploratory analysis of a scraped laptop dataset for a price-prediction learning project.",
        eyebrow="Laptop Price Predictor · EDA",
        lead="What is in the data, how clean it is, and which specs go together with higher prices.",
        header_note=f"Source file: {args.input.name} · {log['raw_rows']:,} rows · {raw.shape[1]} columns",
        nav=[("overview", "Overview"), ("quality", "Data quality"), ("price", "Price"), ("brands", "Brands"),
             ("specs", "Specs"), ("relationships", "Relationships"), ("columns", "Column guide"), ("limits", "Limitations")],
        s=s, findings=findings, quality=quality, charts=build_charts(df), columns=column_table(raw),
        plotly_js=get_plotlyjs(), generated=date.today().isoformat(), versions=versions(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding="utf-8")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
