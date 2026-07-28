#!/usr/bin/env python3
"""Strike-classifier training (E14). Logistic regression over Metrics Core
features — deliberately simple: the features carry the physics, and the
exported weights must stay portable to Rust (plain means/stds/coef JSON,
no runtime dependency on sklearn).

Usage: train.py features.csv [more.csv ...] --out model.json
"""
import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score

NUMERIC = ["peak_speed", "straightness", "extension_frac", "duration_ms"]


def load(paths: list[Path]):
    X, y = [], []
    for p in paths:
        for row in csv.DictReader(p.open()):
            feats = [float(row[k]) if row[k] != "" else np.nan for k in NUMERIC]
            X.append(feats)
            y.append(row["label"])
    X = np.array(X)
    # Median-impute missing values (unobservable metrics stay honest as NaN
    # upstream; the model needs numbers — medians are recorded for serving).
    med = np.nanmedian(X, axis=0)
    idx = np.where(np.isnan(X))
    X[idx] = np.take(med, idx[1])
    return X, np.array(y), med


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("csvs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--folds", type=int, default=5)
    args = ap.parse_args()

    X, y, med = load(args.csvs)
    classes = sorted(set(y))
    if len(classes) < 2:
        sys.exit("need >=2 classes to train")
    n_per = {c: int((y == c).sum()) for c in classes}
    print(f"[train] {len(y)} events, classes: {n_per}")

    mean, std = X.mean(axis=0), X.std(axis=0)
    std[std == 0] = 1.0
    Xs = (X - mean) / std

    clf = LogisticRegression(max_iter=1000)
    folds = min(args.folds, min(n_per.values()))
    if folds >= 2:
        scores = cross_val_score(clf, Xs, y, cv=StratifiedKFold(folds, shuffle=True, random_state=7))
        print(f"[train] {folds}-fold accuracy: {scores.mean():.3f} ± {scores.std():.3f}")
    clf.fit(Xs, y)

    model = {
        "version": 1,
        "kind": "logreg-v0",
        "features": NUMERIC,
        "impute_median": med.tolist(),
        "standardize": {"mean": mean.tolist(), "std": std.tolist()},
        "classes": list(clf.classes_),
        "coef": clf.coef_.tolist(),
        "intercept": clf.intercept_.tolist(),
    }
    args.out.write_text(json.dumps(model, indent=2))
    print(f"[train] model -> {args.out}")


if __name__ == "__main__":
    main()
