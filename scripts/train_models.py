#!/usr/bin/env python3
"""Benchmark laptop price regressors and produce an offline HTML report.

Procedure
  1. Clean the data and turn CPU / GPU text into numbers (scripts/common.py).
  2. Hold out a random 20% test set (random_state 42). It is used only once, at the end.
  3. Compare 7 models (including a median baseline) with 5-fold cross-validation
     on the 80% training set, and select the lowest mean validation RMSE.
  4. Refit every model on the full training set and score it on the test set.
  5. Check the selected model on laptop models it has never seen (GroupKFold by TypeName).
  6. Save the selected pipeline, metrics, predictions and metadata to models/laptops/
     and write reports/laptops_models.html.

    python scripts/train_models.py
    python scripts/train_models.py --report-only   # rebuild the HTML from saved results
"""
from __future__ import annotations

import argparse
import json
import platform
import time
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import plotly
import plotly.graph_objects as go
import sklearn
from plotly.offline import get_plotlyjs
from sklearn.base import clone
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, KFold, train_test_split
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeRegressor

from common import (DATA, ENGINEERED, MODELS, NUMERIC, RANDOM_STATE, REPORTS, TEST_SIZE,
                    clean, design_matrix, load_raw, sha256, target)
from eda import ACCENT, AMBER, TEAL, render_env, to_html

MODEL_INFO = {
    "Median baseline": ("Reference", "Always predicts the median training price. A useful model must beat this.",
                        "No learned rules."),
    "Linear regression": ("Linear", "A weighted sum of the specs (after scaling), fitted to log prices.",
                          "Ordinary least squares; standardised inputs."),
    "Ridge regression": ("Linear", "Linear regression that shrinks weights to stay stable when specs are correlated.",
                         "L2 penalty alpha=1; standardised inputs."),
    "k-nearest neighbours": ("Instance", "Finds the 5 most similar laptops and averages their prices.",
                             "k=5; Euclidean distance on standardised inputs."),
    "Decision tree": ("Tree", "A chain of yes/no questions such as \"RAM above 24 GB?\".",
                      "At least 2 laptops per leaf; no depth limit."),
    "Random forest": ("Ensemble", "Averages 400 trees, each trained on a random sample, to reduce the instability of one tree.",
                      "400 trees; default settings otherwise."),
    "Gradient boosting": ("Boosting", "Adds small trees one by one, each correcting the errors left by the earlier ones.",
                          "500 trees; depth 3; learning rate 0.05."),
}
METRIC_INFO = [
    ("R²", "Share of price differences the model explains. 1 = perfect, 0 = no better than always guessing the average."),
    ("MAE", "Mean absolute error: how far off a prediction is on average, in price units."),
    ("RMSE", "Root mean squared error: like MAE, but large mistakes count more. Used to select the model."),
    ("MAPE", "Mean absolute percentage error: the average error as a % of the real price."),
]


def build_models() -> dict:
    return {
        "Median baseline": DummyRegressor(strategy="median"),
        "Linear regression": make_pipeline(StandardScaler(), LinearRegression()),
        "Ridge regression": make_pipeline(StandardScaler(), Ridge()),
        "k-nearest neighbours": make_pipeline(StandardScaler(), KNeighborsRegressor(5)),
        "Decision tree": DecisionTreeRegressor(min_samples_leaf=2, random_state=RANDOM_STATE),
        "Random forest": RandomForestRegressor(400, random_state=RANDOM_STATE),
        "Gradient boosting": GradientBoostingRegressor(n_estimators=500, learning_rate=0.05, random_state=RANDOM_STATE),
    }


def metrics(actual, predicted) -> dict:
    actual, predicted = np.asarray(actual), np.asarray(predicted)
    return {
        "r2": float(r2_score(actual, predicted)),
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "mape": float(np.mean(np.abs(predicted - actual) / actual) * 100),
    }


def train(data: Path, out: Path) -> None:
    started = time.time()
    df, log = clean(load_raw(data))
    df = df.reset_index(drop=True)
    X, y = design_matrix(df), target(df)

    idx_tr, idx_te = train_test_split(np.arange(len(df)), test_size=TEST_SIZE, random_state=RANDOM_STATE)
    Xtr, Xte, ytr, yte = X.iloc[idx_tr], X.iloc[idx_te], y[idx_tr], y[idx_te]

    # Validation: 5-fold cross-validation inside the training set only.
    folds = KFold(5, shuffle=True, random_state=RANDOM_STATE)
    val_rows = []
    for name, model in build_models().items():
        for k, (a, b) in enumerate(folds.split(Xtr)):
            m = clone(model).fit(Xtr.iloc[a], ytr[a])
            val_rows.append({"model": name, "fold": k + 1, **metrics(np.exp(ytr[b]), np.exp(m.predict(Xtr.iloc[b])))})
    val = pd.DataFrame(val_rows)
    val_mean = val.groupby("model")[["r2", "mae", "rmse", "mape"]].mean()
    selected = val_mean.rmse.idxmin()
    print(f"Selected by validation RMSE: {selected}")

    # Final test: refit on the whole training set, score once on the hidden 20%.
    test_rows, fitted, preds = [], {}, {}
    for name, model in build_models().items():
        fitted[name] = clone(model).fit(Xtr, ytr)
        preds[name] = np.exp(fitted[name].predict(Xte))
        m = metrics(np.exp(yte), preds[name])
        test_rows.append({"model": name, "family": MODEL_INFO[name][0],
                          "val_rmse": val_mean.rmse[name], "val_r2": val_mean.r2[name], **m})
        print(f"{name:22s} test R2={m['r2']:.3f}  MAE={m['mae']:.0f}")
    test = pd.DataFrame(test_rows).sort_values("val_rmse").reset_index(drop=True)

    # Unseen laptop models: every fold holds out whole model names.
    groups = df.TypeName.values
    unseen = []
    for a, b in GroupKFold(5).split(X, y, groups):
        m = clone(build_models()[selected]).fit(X.iloc[a], y[a])
        unseen.append(metrics(np.exp(y[b]), np.exp(m.predict(X.iloc[b]))))
    unseen = pd.DataFrame(unseen).mean().to_dict()
    print(f"{selected} on unseen laptop models: R2={unseen['r2']:.2f}")

    best = fitted[selected]
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": best, "columns": list(X.columns), "name": selected}, out / "best_model.joblib")
    test.round(4).to_csv(out / "model_metrics.csv", index=False)
    val.round(4).to_csv(out / "validation_metrics.csv", index=False)
    tp = df.iloc[idx_te][["Company", "TypeName", "Cpu", "Gpu", "Ram_GB", "SSD"]].copy()
    tp["actual_price"] = np.exp(yte).round(2)
    tp["predicted_price"] = preds[selected].round(2)
    tp["error"] = (tp.predicted_price - tp.actual_price).round(2)
    tp.to_csv(out / "test_predictions.csv", index=False)
    if hasattr(best, "feature_importances_"):
        (pd.Series(best.feature_importances_, index=X.columns, name="importance").sort_values(ascending=False)
         .round(5).rename_axis("feature").to_csv(out / "feature_importance.csv"))

    meta = {
        "selected_model": selected,
        "selection_rule": "lowest mean RMSE over 5-fold cross-validation on the training set",
        "target": "log(Price); all reported errors are in original price units (treated as USD)",
        "data_file": data.name, "data_sha256": sha256(data), "cleaning": log,
        "split": {"method": "random", "test_size": TEST_SIZE, "random_state": RANDOM_STATE,
                  "train_rows": int(len(idx_tr)), "test_rows": int(len(idx_te))},
        "test_index": [int(i) for i in idx_te],
        "features": {"numeric": NUMERIC, "engineered": ENGINEERED, "all_columns": list(X.columns)},
        "unseen_models_check": {"method": "GroupKFold(5) grouped by TypeName, all rows",
                                **{k: round(v, 4) for k, v in unseen.items()}},
        "runtime_seconds": round(time.time() - started, 1),
        "trained_on": date.today().isoformat(),
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                     "pandas": pd.__version__, "numpy": np.__version__, "plotly": plotly.__version__},
    }
    (out / "model_metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def report(out: Path, path: Path) -> None:
    """Build the HTML report from the files saved in models/laptops/."""
    meta = json.loads((out / "model_metadata.json").read_text())
    test = pd.read_csv(out / "model_metrics.csv")
    val = pd.read_csv(out / "validation_metrics.csv")
    tp = pd.read_csv(out / "test_predictions.csv")
    fi_path = out / "feature_importance.csv"
    fi = pd.read_csv(fi_path) if fi_path.exists() else None
    selected = meta["selected_model"]
    sel = test.set_index("model").loc[selected]
    charts = {}

    order = test.sort_values("r2").model
    t = test.set_index("model").loc[order]
    fig = go.Figure(go.Bar(x=t.r2.clip(lower=0), y=order, orientation="h",
                           marker_color=[TEAL if m == selected else ACCENT for m in order],
                           text=[f"{v:.3f}" for v in t.r2], textposition="outside"))
    fig.update_layout(title="Test R² by model (higher is better)", xaxis=dict(range=[0, 1.08]))
    charts["r2"] = to_html(fig, 400)

    fig = go.Figure()
    for name in test.model:
        if name == "Median baseline":
            continue
        fig.add_trace(go.Box(y=val[val.model == name].rmse, name=name, marker_color=TEAL if name == selected else ACCENT, showlegend=False))
    fig.update_layout(title="Validation RMSE in each of the 5 folds (lower is better)", yaxis_title="RMSE")
    charts["val"] = to_html(fig, 420)

    lo, hi = tp[["actual_price", "predicted_price"]].min().min(), tp[["actual_price", "predicted_price"]].max().max()
    fig = go.Figure([
        go.Scatter(x=[lo, hi], y=[lo, hi], mode="lines", line=dict(color=TEAL, dash="dash"), name="perfect prediction"),
        go.Scatter(x=tp.actual_price, y=tp.predicted_price, mode="markers", name="test laptops",
                   marker=dict(color=ACCENT, opacity=.55, size=7), text=tp.TypeName,
                   hovertemplate="%{text}<br>actual %{x:,.0f} · predicted %{y:,.0f}<extra></extra>"),
    ])
    fig.update_layout(title=f"{selected}: predicted vs actual price ({len(tp)} test laptops)",
                      xaxis_title="Actual price", yaxis_title="Predicted price", legend=dict(orientation="h", y=1.08))
    charts["scatter"] = to_html(fig, 520)

    bands = pd.cut(tp.actual_price, [0, 1000, 1500, 2000, 3000, 10000], labels=["< 1,000", "1,000–1,500", "1,500–2,000", "2,000–3,000", "> 3,000"])
    err = tp.assign(band=bands, abs_err=tp.error.abs()).groupby("band", observed=True).abs_err.agg(["mean", "count"])
    fig = go.Figure(go.Bar(x=[f"{b} ({int(c)})" for b, c in zip(err.index, err["count"])], y=err["mean"], marker_color=AMBER,
                           hovertemplate="%{x}: average error %{y:,.0f}<extra></extra>"))
    fig.update_layout(title="Average error by price band (number of test laptops)", yaxis_title="MAE")
    charts["bands"] = to_html(fig, 380)

    if fi is not None:
        top = fi.head(12).iloc[::-1]
        fig = go.Figure(go.Bar(x=top.importance * 100, y=top.feature, orientation="h", marker_color=ACCENT,
                               hovertemplate="%{y}: %{x:.1f}%<extra></extra>"))
        fig.update_layout(title="What the selected model relies on (feature importance, %)")
        charts["importance"] = to_html(fig, 440)

    worst = tp.reindex(tp.error.abs().sort_values(ascending=False).index).head(8)
    baseline = test.set_index("model").loc["Median baseline"]
    html = render_env().get_template("laptops_models.html.j2").render(
        title="Laptop prices · Model comparison",
        description="Comparison of seven regression models that predict laptop prices from their specifications.",
        eyebrow="Laptop Price Predictor · Models",
        lead=f"Seven models, one honest test. On the hidden 20% test set, {selected} explains {sel.r2:.1%} of price differences; on completely unseen laptop models, R² is {meta['unseen_models_check']['r2']:.2f}.",
        header_note=f"{meta['cleaning']['rows_used']:,} laptops · {meta['split']['train_rows']:,} train / {meta['split']['test_rows']} test · random_state {meta['split']['random_state']} · trained {meta['trained_on']}",
        nav=[("summary", "Summary"), ("results", "Results"), ("errors", "Errors"), ("drivers", "What matters"),
             ("unseen", "Unseen models"), ("models", "Model settings"), ("method", "Method"), ("limits", "Limitations")],
        meta=meta, test=test.to_dict("records"), sel=sel, selected=selected, baseline=baseline,
        unseen=meta["unseen_models_check"], charts=charts, worst=worst.to_dict("records"),
        model_info=MODEL_INFO, metric_info=METRIC_INFO, top_features=(fi.head(3).to_dict("records") if fi is not None else []),
        plotly_js=get_plotlyjs(), generated=date.today().isoformat(), versions=meta["versions"],
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    print(f"Saved {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, default=DATA, help="laptop CSV with the original column names")
    ap.add_argument("--models-dir", type=Path, default=MODELS, help="where to save the model and its results")
    ap.add_argument("--report", type=Path, default=REPORTS / "laptops_models.html", help="where to write the HTML report")
    ap.add_argument("--report-only", action="store_true", help="skip training; rebuild the report from saved results")
    args = ap.parse_args()
    if not args.report_only:
        train(args.input, args.models_dir)
    report(args.models_dir, args.report)


if __name__ == "__main__":
    main()
