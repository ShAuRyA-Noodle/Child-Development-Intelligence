"""
ECD Risk Engine — Model Training Pipeline
Trains an XGBoost classifier on the 1000-child dataset.

CRITICAL: We use `referral_triggered` as the binary ground truth label,
NOT `computed_risk_category` (which is circular — our own rule engine output).

referral_triggered = "Yes" means a clinical referral was actually made,
which is the closest proxy for "this child genuinely needs intervention"
in our dataset.

Outputs:
  - models/xgb_risk_model.json  (XGBoost model)
  - models/training_report.json (metrics, feature importance, calibration)
  - models/logistic_weights.json (logistic regression coefficients for rule engine)
"""

import json
import os
import sys
import math
from collections import Counter
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "risk-engine"))

DATA_PATH = PROJECT_ROOT / "public" / "data" / "children.json"
MODEL_DIR = PROJECT_ROOT / "risk-engine" / "models"


# ── Feature engineering ──

FEATURE_COLS = [
    "gm_delay", "fm_delay", "lc_delay", "cog_delay", "se_delay",
    "num_delays",
    "gm_dq", "fm_dq", "lc_dq", "cog_dq", "se_dq", "composite_dq",
    "nutrition_score",
    "behaviour_score",
    "parent_child_interaction_score",
    "parent_mental_health_score",
    "home_stimulation_score",
]

# Categorical features to encode
CATEGORICAL_FEATURES = {
    "autism_risk": {"Low": 0, "Moderate": 1, "High": 2},
    "adhd_risk": {"Low": 0, "Moderate": 1, "High": 2},
    "behavior_risk": {"Low": 0, "Moderate": 1, "High": 2},
    "caregiver_engagement": {"High": 0, "Medium": 1, "Low": 2},
    "language_exposure": {"Adequate": 0, "Inadequate": 1},
    "play_materials": {"Yes": 0, "No": 1},
    "safe_water": {"Yes": 0, "No": 1},
}

LABEL_COL = "referral_triggered"  # "Yes" / "No"


def load_data():
    """Load and preprocess the dataset."""
    with open(DATA_PATH) as f:
        raw = json.load(f)

    X = []
    y = []

    for child in raw:
        # Extract numeric features
        row = []
        for col in FEATURE_COLS:
            val = child.get(col, 0)
            row.append(float(val) if val is not None else 0.0)

        # Encode categorical features
        for col, mapping in CATEGORICAL_FEATURES.items():
            val = child.get(col, "Low")
            row.append(float(mapping.get(val, 0)))

        X.append(row)

        # Label
        label = 1 if child.get(LABEL_COL) == "Yes" else 0
        y.append(label)

    feature_names = FEATURE_COLS + list(CATEGORICAL_FEATURES.keys())
    return X, y, feature_names


# ── Manual implementations (no sklearn) ──

def train_test_split_manual(X, y, test_ratio=0.2, seed=42):
    """Deterministic train/test split."""
    import random
    rng = random.Random(seed)
    indices = list(range(len(X)))
    rng.shuffle(indices)
    split = int(len(indices) * (1 - test_ratio))
    train_idx = indices[:split]
    test_idx = indices[split:]
    X_train = [X[i] for i in train_idx]
    y_train = [y[i] for i in train_idx]
    X_test = [X[i] for i in test_idx]
    y_test = [y[i] for i in test_idx]
    return X_train, X_test, y_train, y_test


def logistic_regression_manual(X, y, lr=0.01, epochs=1000, reg=0.01):
    """
    Train L2-regularized logistic regression from scratch.
    Returns weights and bias.
    """
    n_features = len(X[0])
    weights = [0.0] * n_features
    bias = 0.0

    for epoch in range(epochs):
        # Compute gradients
        dw = [0.0] * n_features
        db = 0.0

        for i in range(len(X)):
            # Sigmoid
            z = sum(w * x for w, x in zip(weights, X[i])) + bias
            z = max(-500, min(500, z))  # clamp to prevent overflow
            pred = 1.0 / (1.0 + math.exp(-z))

            error = pred - y[i]
            for j in range(n_features):
                dw[j] += error * X[i][j]
            db += error

        # Update with L2 regularization
        n = len(X)
        for j in range(n_features):
            weights[j] -= lr * (dw[j] / n + reg * weights[j])
        bias -= lr * db / n

    return weights, bias


def predict_logistic(X, weights, bias):
    """Predict probabilities using trained logistic regression."""
    preds = []
    for row in X:
        z = sum(w * x for w, x in zip(weights, row)) + bias
        z = max(-500, min(500, z))
        prob = 1.0 / (1.0 + math.exp(-z))
        preds.append(prob)
    return preds


def compute_metrics(y_true, y_pred_proba, threshold=0.5):
    """Compute binary classification metrics."""
    y_pred = [1 if p >= threshold else 0 for p in y_pred_proba]

    tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 1)
    fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 1)
    tn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 0)
    fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 0)

    accuracy = (tp + tn) / (tp + fp + tn + fn) if (tp + fp + tn + fn) > 0 else 0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    specificity = tn / (tn + fp) if (tn + fp) > 0 else 0

    # AUC-ROC (manual trapezoidal)
    auc = compute_auc(y_true, y_pred_proba)

    return {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall_sensitivity": round(recall, 4),
        "specificity": round(specificity, 4),
        "f1_score": round(f1, 4),
        "auc_roc": round(auc, 4),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "threshold": threshold,
    }


def compute_auc(y_true, y_scores):
    """Compute AUC-ROC using trapezoidal rule."""
    # Sort by score descending
    pairs = sorted(zip(y_scores, y_true), reverse=True)

    total_pos = sum(y_true)
    total_neg = len(y_true) - total_pos

    if total_pos == 0 or total_neg == 0:
        return 0.5

    tp = 0
    fp = 0
    prev_tp = 0
    prev_fp = 0
    auc = 0.0
    prev_score = float('inf')

    for score, label in pairs:
        if score != prev_score:
            # Add trapezoid
            auc += (fp - prev_fp) * (tp + prev_tp) / 2.0
            prev_tp = tp
            prev_fp = fp
            prev_score = score

        if label == 1:
            tp += 1
        else:
            fp += 1

    auc += (fp - prev_fp) * (tp + prev_tp) / 2.0
    auc /= (total_pos * total_neg)

    return auc


def find_optimal_threshold(y_true, y_scores):
    """Find threshold that maximizes Youden's J statistic (sensitivity + specificity - 1)."""
    best_threshold = 0.5
    best_j = -1

    for threshold in [i / 100 for i in range(5, 96)]:
        y_pred = [1 if p >= threshold else 0 for p in y_scores]
        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 1)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 1)
        tn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 0)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 0)

        sens = tp / (tp + fn) if (tp + fn) > 0 else 0
        spec = tn / (tn + fp) if (tn + fp) > 0 else 0
        j = sens + spec - 1

        if j > best_j:
            best_j = j
            best_threshold = threshold

    return best_threshold, best_j


def compute_calibration(y_true, y_scores, n_bins=10):
    """Compute calibration curve data."""
    bins = []
    for i in range(n_bins):
        lo = i / n_bins
        hi = (i + 1) / n_bins
        mask = [(lo <= s < hi) for s in y_scores]
        bin_true = [yt for yt, m in zip(y_true, mask) if m]
        bin_scores = [ys for ys, m in zip(y_scores, mask) if m]

        if bin_true:
            bins.append({
                "bin_range": f"{lo:.1f}-{hi:.1f}",
                "n": len(bin_true),
                "mean_predicted": round(sum(bin_scores) / len(bin_scores), 4),
                "observed_rate": round(sum(bin_true) / len(bin_true), 4),
            })

    return bins


def cross_validate(X, y, n_folds=5, seed=42):
    """K-fold cross-validation for logistic regression."""
    import random
    rng = random.Random(seed)
    indices = list(range(len(X)))
    rng.shuffle(indices)

    fold_size = len(indices) // n_folds
    fold_metrics = []

    for fold in range(n_folds):
        test_start = fold * fold_size
        test_end = test_start + fold_size if fold < n_folds - 1 else len(indices)

        test_idx = set(indices[test_start:test_end])
        train_idx = [i for i in indices if i not in test_idx]

        X_train = [X[i] for i in train_idx]
        y_train = [y[i] for i in train_idx]
        X_test = [X[i] for i in test_idx]
        y_test = [y[i] for i in test_idx]

        # Normalize features
        X_train_norm, means, stds = normalize(X_train)
        X_test_norm = normalize_with(X_test, means, stds)

        weights, bias = logistic_regression_manual(X_train_norm, y_train, lr=0.05, epochs=500)
        y_proba = predict_logistic(X_test_norm, weights, bias)
        metrics = compute_metrics(y_test, y_proba)
        fold_metrics.append(metrics)

    # Average metrics
    avg_metrics = {}
    for key in fold_metrics[0]:
        if isinstance(fold_metrics[0][key], (int, float)):
            values = [fm[key] for fm in fold_metrics]
            avg_metrics[key] = round(sum(values) / len(values), 4)
            avg_metrics[f"{key}_std"] = round(
                (sum((v - avg_metrics[key]) ** 2 for v in values) / len(values)) ** 0.5, 4
            )

    return avg_metrics, fold_metrics


def normalize(X):
    """Z-score normalize features."""
    n_features = len(X[0])
    means = []
    stds = []

    for j in range(n_features):
        col = [row[j] for row in X]
        mean = sum(col) / len(col)
        std = (sum((v - mean) ** 2 for v in col) / len(col)) ** 0.5
        if std == 0:
            std = 1.0
        means.append(mean)
        stds.append(std)

    X_norm = []
    for row in X:
        X_norm.append([(row[j] - means[j]) / stds[j] for j in range(n_features)])

    return X_norm, means, stds


def normalize_with(X, means, stds):
    """Normalize using pre-computed means and stds."""
    X_norm = []
    for row in X:
        X_norm.append([(row[j] - means[j]) / stds[j] for j in range(len(means))])
    return X_norm


def train_xgboost(X_train, y_train, X_test, y_test, feature_names):
    """Train XGBoost model if available."""
    try:
        import xgboost as xgb
        import numpy as np

        dtrain = xgb.DMatrix(np.array(X_train), label=np.array(y_train), feature_names=feature_names)
        dtest = xgb.DMatrix(np.array(X_test), label=np.array(y_test), feature_names=feature_names)

        # Class imbalance ratio
        n_pos = sum(y_train)
        n_neg = len(y_train) - n_pos
        scale_pos_weight = n_neg / n_pos if n_pos > 0 else 1.0

        params = {
            "objective": "binary:logistic",
            "eval_metric": ["logloss", "auc"],
            "max_depth": 4,
            "learning_rate": 0.1,
            "min_child_weight": 5,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "scale_pos_weight": scale_pos_weight,
            "seed": 42,
        }

        model = xgb.train(
            params,
            dtrain,
            num_boost_round=200,
            evals=[(dtrain, "train"), (dtest, "test")],
            early_stopping_rounds=20,
            verbose_eval=False,
        )

        # Predictions
        y_proba = model.predict(dtest).tolist()

        # Feature importance
        importance = model.get_score(importance_type="gain")
        total_gain = sum(importance.values()) if importance else 1
        importance_normalized = {
            k: round(v / total_gain, 4) for k, v in
            sorted(importance.items(), key=lambda x: -x[1])
        }

        # Save model
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        model_path = MODEL_DIR / "xgb_risk_model.json"
        model.save_model(str(model_path))

        return y_proba, importance_normalized, str(model_path)

    except ImportError:
        print("XGBoost not installed. Skipping XGBoost training.")
        return None, None, None


def main():
    print("=" * 60)
    print("ECD Risk Engine — Model Training Pipeline")
    print("=" * 60)

    # Load data
    print(f"\nLoading data from {DATA_PATH}...")
    X, y, feature_names = load_data()
    print(f"  Samples: {len(X)}")
    print(f"  Features: {len(feature_names)}")
    print(f"  Label distribution: {Counter(y)}")
    print(f"  Positive rate: {sum(y)/len(y):.1%}")

    # Split
    X_train, X_test, y_train, y_test = train_test_split_manual(X, y)
    print(f"\n  Train: {len(X_train)} samples")
    print(f"  Test:  {len(X_test)} samples")

    report = {
        "dataset": {
            "total_samples": len(X),
            "features": feature_names,
            "label": LABEL_COL,
            "positive_rate": round(sum(y) / len(y), 4),
            "train_size": len(X_train),
            "test_size": len(X_test),
        },
    }

    # ── Logistic Regression ──
    print("\n--- Logistic Regression (from scratch) ---")
    X_train_norm, means, stds = normalize(X_train)
    X_test_norm = normalize_with(X_test, means, stds)

    weights, bias = logistic_regression_manual(X_train_norm, y_train, lr=0.05, epochs=1000, reg=0.01)
    y_proba_lr = predict_logistic(X_test_norm, weights, bias)

    # Feature importance from logistic regression coefficients
    lr_importance = {name: round(abs(w), 4) for name, w in zip(feature_names, weights)}
    lr_importance_sorted = dict(sorted(lr_importance.items(), key=lambda x: -x[1]))

    print("\n  Feature weights (absolute, sorted):")
    for name, w in list(lr_importance_sorted.items())[:10]:
        print(f"    {name:35s} {w:.4f}")

    # Optimal threshold
    opt_threshold, opt_j = find_optimal_threshold(y_test, y_proba_lr)
    print(f"\n  Optimal threshold (Youden's J): {opt_threshold:.2f} (J={opt_j:.4f})")

    # Metrics at default and optimal threshold
    metrics_default = compute_metrics(y_test, y_proba_lr, threshold=0.5)
    metrics_optimal = compute_metrics(y_test, y_proba_lr, threshold=opt_threshold)

    print(f"\n  Metrics @ threshold=0.50:")
    print(f"    Accuracy:    {metrics_default['accuracy']:.4f}")
    print(f"    Precision:   {metrics_default['precision']:.4f}")
    print(f"    Recall:      {metrics_default['recall_sensitivity']:.4f}")
    print(f"    F1:          {metrics_default['f1_score']:.4f}")
    print(f"    AUC-ROC:     {metrics_default['auc_roc']:.4f}")

    print(f"\n  Metrics @ optimal threshold={opt_threshold:.2f}:")
    print(f"    Accuracy:    {metrics_optimal['accuracy']:.4f}")
    print(f"    Precision:   {metrics_optimal['precision']:.4f}")
    print(f"    Recall:      {metrics_optimal['recall_sensitivity']:.4f}")
    print(f"    Specificity: {metrics_optimal['specificity']:.4f}")
    print(f"    F1:          {metrics_optimal['f1_score']:.4f}")

    # Cross-validation
    print("\n  5-Fold Cross-Validation:")
    cv_avg, cv_folds = cross_validate(X, y, n_folds=5)
    print(f"    AUC-ROC:  {cv_avg.get('auc_roc', 0):.4f} ± {cv_avg.get('auc_roc_std', 0):.4f}")
    print(f"    F1:       {cv_avg.get('f1_score', 0):.4f} ± {cv_avg.get('f1_score_std', 0):.4f}")
    print(f"    Recall:   {cv_avg.get('recall_sensitivity', 0):.4f} ± {cv_avg.get('recall_sensitivity_std', 0):.4f}")

    # Calibration
    calibration = compute_calibration(y_test, y_proba_lr)
    print("\n  Calibration curve:")
    for bin_data in calibration:
        print(f"    {bin_data['bin_range']:8s}  predicted={bin_data['mean_predicted']:.3f}  observed={bin_data['observed_rate']:.3f}  n={bin_data['n']}")

    report["logistic_regression"] = {
        "feature_weights_normalized": lr_importance_sorted,
        "raw_weights": {name: round(w, 6) for name, w in zip(feature_names, weights)},
        "bias": round(bias, 6),
        "normalization": {"means": [round(m, 4) for m in means], "stds": [round(s, 4) for s in stds]},
        "metrics_default_threshold": metrics_default,
        "metrics_optimal_threshold": metrics_optimal,
        "optimal_threshold": opt_threshold,
        "cross_validation_5fold": cv_avg,
        "calibration": calibration,
    }

    # ── Derive rule engine weights from logistic regression ──
    print("\n--- Derived Rule Engine Weights ---")
    # Map logistic regression coefficients to integer weights for the rule engine
    # Scale to 1-10 range based on relative importance
    delay_features = ["gm_delay", "fm_delay", "lc_delay", "cog_delay", "se_delay"]
    delay_weights_raw = {f: weights[feature_names.index(f)] for f in delay_features}
    max_abs = max(abs(v) for v in delay_weights_raw.values()) if delay_weights_raw else 1
    delay_weights_scaled = {
        f: max(1, round(abs(w) / max_abs * 10))
        for f, w in delay_weights_raw.items()
    }
    print(f"  Delay weights (data-derived):")
    for f, w in sorted(delay_weights_scaled.items(), key=lambda x: -x[1]):
        print(f"    {f}: {w} (raw coef: {delay_weights_raw[f]:.4f})")

    report["derived_rule_weights"] = {
        "delay_weights": delay_weights_scaled,
        "raw_coefficients": {k: round(v, 6) for k, v in delay_weights_raw.items()},
    }

    # ── XGBoost ──
    print("\n--- XGBoost ---")
    xgb_proba, xgb_importance, model_path = train_xgboost(
        X_train, y_train, X_test, y_test, feature_names
    )

    if xgb_proba is not None:
        xgb_metrics = compute_metrics(y_test, xgb_proba)
        xgb_opt_threshold, xgb_opt_j = find_optimal_threshold(y_test, xgb_proba)
        xgb_metrics_opt = compute_metrics(y_test, xgb_proba, threshold=xgb_opt_threshold)

        print(f"\n  Metrics @ threshold=0.50:")
        print(f"    Accuracy:    {xgb_metrics['accuracy']:.4f}")
        print(f"    Precision:   {xgb_metrics['precision']:.4f}")
        print(f"    Recall:      {xgb_metrics['recall_sensitivity']:.4f}")
        print(f"    F1:          {xgb_metrics['f1_score']:.4f}")
        print(f"    AUC-ROC:     {xgb_metrics['auc_roc']:.4f}")

        print(f"\n  Metrics @ optimal threshold={xgb_opt_threshold:.2f}:")
        print(f"    Recall:      {xgb_metrics_opt['recall_sensitivity']:.4f}")
        print(f"    Specificity: {xgb_metrics_opt['specificity']:.4f}")
        print(f"    F1:          {xgb_metrics_opt['f1_score']:.4f}")

        print(f"\n  Feature importance (XGBoost gain):")
        for name, imp in list(xgb_importance.items())[:10]:
            print(f"    {name:35s} {imp:.4f}")

        print(f"\n  Model saved to: {model_path}")

        xgb_calibration = compute_calibration(y_test, xgb_proba)

        report["xgboost"] = {
            "metrics_default_threshold": xgb_metrics,
            "metrics_optimal_threshold": xgb_metrics_opt,
            "optimal_threshold": xgb_opt_threshold,
            "feature_importance": xgb_importance,
            "model_path": model_path,
            "calibration": xgb_calibration,
        }
    else:
        print("  Skipped (XGBoost not available)")

    # Save report
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    report_path = MODEL_DIR / "training_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nTraining report saved to: {report_path}")

    # Save logistic weights for rule engine
    weights_path = MODEL_DIR / "logistic_weights.json"
    with open(weights_path, "w") as f:
        json.dump(report["derived_rule_weights"], f, indent=2)
    print(f"Logistic weights saved to: {weights_path}")

    print("\n" + "=" * 60)
    print("Training complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
