#!/usr/bin/env python3
import base64
import io
import json
import re
import sys
from typing import Any

import numpy as np
import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

try:
    from scipy import stats as scipy_stats  # type: ignore
except Exception:
    scipy_stats = None

try:
    from sklearn.decomposition import FactorAnalysis  # type: ignore
except Exception:
    FactorAnalysis = None

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt  # type: ignore
except Exception:
    plt = None


def finite(values):
    return pd.to_numeric(values, errors="coerce").dropna().astype(float).to_numpy()


def read_frame(payload: dict[str, Any]) -> pd.DataFrame:
    file_name = str(payload.get("fileName") or "dataset.csv")
    if payload.get("base64"):
        raw = base64.b64decode(str(payload["base64"]))
        if file_name.lower().endswith((".xlsx", ".xls")):
            return pd.read_excel(io.BytesIO(raw))
        return pd.read_csv(io.BytesIO(raw))
    text = str(payload.get("text") or "")
    if not text.strip():
        raise ValueError("数据文件为空。")
    return pd.read_csv(io.StringIO(text))


def numeric_columns(df: pd.DataFrame) -> list[str]:
    cols = []
    for col in df.columns:
        if pd.to_numeric(df[col], errors="coerce").notna().sum() > 0:
            cols.append(str(col))
    return cols


def categorical_columns(df: pd.DataFrame, numeric: list[str]) -> list[str]:
    numeric_set = set(numeric)
    cols = []
    for col in df.columns:
        name = str(col)
        if name in numeric_set:
            continue
        nunique = df[col].dropna().nunique()
        if 1 < nunique <= max(20, len(df) // 2):
            cols.append(name)
    return cols


def plan_methods(payload: dict[str, Any], numeric: list[str], categorical: list[str]) -> list[str]:
    plan = payload.get("confirmedPlan") or {}
    calls = plan.get("toolCalls") if isinstance(plan, dict) else None
    methods = []
    def add_methods(value: Any):
        if isinstance(value, list):
            for item in value:
                add_methods(item)
            return
        for item in str(value or "").replace("，", ",").replace("、", ",").split(","):
            item = item.strip().lower()
            if item:
                methods.append(item)
    if isinstance(calls, list):
        for call in calls:
            if isinstance(call, dict) and isinstance(call.get("tool"), str):
                add_methods(call["tool"])
    if isinstance(plan, dict):
        raw_methods = plan.get("methods")
        if isinstance(raw_methods, list):
            add_methods(raw_methods)
        if isinstance(plan.get("method"), str):
            add_methods(plan["method"])
    if isinstance(payload.get("method"), str):
        add_methods(payload["method"])
    if not methods:
        methods = ["descriptive"]
        if len(numeric) >= 2:
            methods.append("correlation")
        if len(numeric) >= 3:
            methods.append("cronbach_alpha")
            methods.append("regression_analysis")
        if categorical:
            methods.append("anova")
    allowed = ["descriptive", "cronbach_alpha", "correlation", "regression_analysis", "anova", "t_test", "mediation_model_4", "efa", "validity_tests"]
    unique = []
    for method in methods:
        normalized = {
            "cronbach": "cronbach_alpha",
            "alpha": "cronbach_alpha",
            "regression": "regression_analysis",
            "linear_regression": "regression_analysis",
            "ols": "regression_analysis",
            "ttest": "t_test",
            "t-test": "t_test",
            "independent_t_test": "t_test",
            "kmo": "validity_tests",
            "bartlett": "validity_tests",
            "validity": "validity_tests",
            "mediation": "mediation_model_4",
            "process_model_4": "mediation_model_4",
        }.get(method, method)
        if normalized in allowed and normalized not in unique:
            unique.append(normalized)
    return unique


def plan_columns(payload: dict[str, Any], fallback: list[str]) -> list[str]:
    plan = payload.get("confirmedPlan") or {}
    if isinstance(plan, dict):
        required = plan.get("requiredColumns")
        if isinstance(required, list):
            cols = [str(col) for col in required if str(col) in fallback]
            if cols:
                return cols
        variables = plan.get("variables")
        if isinstance(variables, list):
            cols = []
            for variable in variables:
                if isinstance(variable, dict) and str(variable.get("column")) in fallback:
                    cols.append(str(variable.get("column")))
            if cols:
                return list(dict.fromkeys(cols))
    return fallback


def describe(df: pd.DataFrame, cols: list[str]) -> list[dict[str, Any]]:
    rows = []
    for col in cols:
        arr = finite(df[col])
        if arr.size == 0:
            continue
        rows.append({
            "variable": col,
            "n": int(arr.size),
            "mean": round(float(np.mean(arr)), 4),
            "sd": round(float(np.std(arr, ddof=1)), 4) if arr.size > 1 else None,
            "min": round(float(np.min(arr)), 4),
            "max": round(float(np.max(arr)), 4),
        })
    return rows


def cronbach_alpha(df: pd.DataFrame, cols: list[str]) -> dict[str, Any] | None:
    if len(cols) < 3:
        return None
    data = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if data.shape[0] < 3:
        return None
    k = data.shape[1]
    item_variances = data.var(axis=0, ddof=1).sum()
    total_variance = data.sum(axis=1).var(ddof=1)
    if total_variance == 0:
        return None
    alpha = k / (k - 1) * (1 - item_variances / total_variance)
    return {"items": cols, "n": int(data.shape[0]), "alpha": round(float(alpha), 4)}


def correlations(df: pd.DataFrame, cols: list[str]) -> list[dict[str, Any]]:
    rows = []
    for i, left in enumerate(cols):
        for right in cols[i + 1:]:
            pair = pd.concat([
                pd.to_numeric(df[left], errors="coerce"),
                pd.to_numeric(df[right], errors="coerce"),
            ], axis=1).dropna()
            if pair.shape[0] < 3:
                continue
            r = float(np.corrcoef(pair.iloc[:, 0], pair.iloc[:, 1])[0, 1])
            p = None
            if scipy_stats is not None:
                _r, p_value = scipy_stats.pearsonr(pair.iloc[:, 0], pair.iloc[:, 1])
                p = round(float(p_value), 6)
            rows.append({"x": left, "y": right, "n": int(pair.shape[0]), "r": round(r, 4), "p": p})
    return rows


def anova(df: pd.DataFrame, cols: list[str], group_column: str | None = None) -> list[dict[str, Any]]:
    non_numeric = [str(col) for col in df.columns if str(col) not in cols]
    group = group_column if group_column in df.columns else (non_numeric[0] if non_numeric else None)
    if not group:
        return []
    results = []
    for col in cols:
        groups = []
        for _name, part in df[[group, col]].dropna().groupby(group):
            values = finite(part[col])
            if values.size >= 2:
                groups.append(values)
        if len(groups) < 2:
            continue
        if scipy_stats is not None:
            f_value, p_value = scipy_stats.f_oneway(*groups)
            results.append({"group": group, "variable": col, "f": round(float(f_value), 4), "p": round(float(p_value), 6)})
        else:
            grand = np.concatenate(groups)
            grand_mean = np.mean(grand)
            ss_between = sum(len(g) * (np.mean(g) - grand_mean) ** 2 for g in groups)
            ss_within = sum(np.sum((g - np.mean(g)) ** 2) for g in groups)
            df_between = len(groups) - 1
            df_within = len(grand) - len(groups)
            f_value = (ss_between / df_between) / (ss_within / df_within) if df_within > 0 and ss_within else None
            results.append({"group": group, "variable": col, "f": round(float(f_value), 4) if f_value else None, "p": None})
    return results


def independent_t_tests(df: pd.DataFrame, cols: list[str], group_column: str | None = None) -> list[dict[str, Any]]:
    non_numeric = [str(col) for col in df.columns if str(col) not in cols]
    candidates = [group_column] if group_column in df.columns else non_numeric
    group = None
    for candidate in candidates:
        if candidate and df[candidate].dropna().nunique() == 2:
            group = candidate
            break
    if not group:
        return []
    results = []
    group_values = list(df[group].dropna().unique())[:2]
    for col in cols:
        left = finite(df.loc[df[group] == group_values[0], col])
        right = finite(df.loc[df[group] == group_values[1], col])
        if left.size < 2 or right.size < 2:
            continue
        mean_diff = float(np.mean(left) - np.mean(right))
        if scipy_stats is not None:
            t_value, p_value = scipy_stats.ttest_ind(left, right, equal_var=False, nan_policy="omit")
            results.append({
                "group": group,
                "variable": col,
                "groupA": str(group_values[0]),
                "groupB": str(group_values[1]),
                "meanA": round(float(np.mean(left)), 4),
                "meanB": round(float(np.mean(right)), 4),
                "meanDiff": round(mean_diff, 4),
                "t": round(float(t_value), 4),
                "p": round(float(p_value), 6),
            })
        else:
            pooled = np.sqrt(np.var(left, ddof=1) / left.size + np.var(right, ddof=1) / right.size)
            t_value = mean_diff / pooled if pooled else None
            results.append({
                "group": group,
                "variable": col,
                "groupA": str(group_values[0]),
                "groupB": str(group_values[1]),
                "meanA": round(float(np.mean(left)), 4),
                "meanB": round(float(np.mean(right)), 4),
                "meanDiff": round(mean_diff, 4),
                "t": round(float(t_value), 4) if t_value is not None else None,
                "p": None,
            })
    return results


def kmo_bartlett(df: pd.DataFrame, cols: list[str]) -> list[dict[str, Any]]:
    if len(cols) < 3:
        return []
    data = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if data.shape[0] < 10:
        return []
    corr = data.corr().to_numpy(dtype=float)
    corr = np.nan_to_num(corr, nan=0.0, posinf=0.0, neginf=0.0)
    np.fill_diagonal(corr, 1.0)
    det = float(np.linalg.det(corr))
    rows: list[dict[str, Any]] = []
    try:
        inv_corr = np.linalg.pinv(corr)
        diag = np.sqrt(np.maximum(np.diag(inv_corr), 1e-12))
        partial = -inv_corr / np.outer(diag, diag)
        np.fill_diagonal(partial, 0.0)
        corr_sq = corr ** 2
        partial_sq = partial ** 2
        np.fill_diagonal(corr_sq, 0.0)
        kmo_value = float(np.sum(corr_sq) / (np.sum(corr_sq) + np.sum(partial_sq)))
        rows.append({
            "test": "KMO",
            "value": round(kmo_value, 4),
            "df": None,
            "p": None,
            "interpretation": "适合因子分析" if kmo_value >= 0.6 else "偏低，需谨慎开展因子分析",
        })
    except Exception:
        pass
    if det > 0:
        p = len(cols)
        n = data.shape[0]
        chi_square = -(n - 1 - (2 * p + 5) / 6) * np.log(det)
        df_value = p * (p - 1) / 2
        p_value = None
        if scipy_stats is not None:
            p_value = float(scipy_stats.chi2.sf(chi_square, df_value))
        rows.append({
            "test": "Bartlett",
            "value": round(float(chi_square), 4),
            "df": int(df_value),
            "p": round(p_value, 6) if p_value is not None else None,
            "interpretation": "变量相关矩阵适合进一步因子分析" if p_value is not None and p_value < 0.05 else "需结合样本量和相关矩阵谨慎判断",
        })
    return rows


def ols_coef(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    x_design = np.column_stack([np.ones(len(x)), x])
    coef, *_ = np.linalg.lstsq(x_design, y, rcond=None)
    return coef


def regression_columns(cols: list[str]) -> tuple[str | None, list[str]]:
    if len(cols) < 2:
        return None, []
    dependent = next((col for col in cols if re.search(r"^(y|dv|因变量|结果)|意愿|满意|接受|购买|传播|评价|结果", col, re.I)), cols[-1])
    predictors = [col for col in cols if col != dependent and not re.search(r"^(m|mediator|中介)", col, re.I)][:5]
    return dependent, predictors


def linear_regression(df: pd.DataFrame, cols: list[str]) -> dict[str, Any] | None:
    y_col, x_cols = regression_columns(cols)
    if not y_col or not x_cols:
        return None
    data = df[[y_col] + x_cols].apply(pd.to_numeric, errors="coerce").dropna()
    if data.shape[0] <= len(x_cols) + 2:
        return None
    y = data[y_col].to_numpy()
    x = data[x_cols].to_numpy()
    x_design = np.column_stack([np.ones(len(x)), x])
    coef, *_ = np.linalg.lstsq(x_design, y, rcond=None)
    predicted = x_design @ coef
    residual = y - predicted
    ss_res = float(np.sum(residual ** 2))
    ss_total = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1 - ss_res / ss_total if ss_total else None
    adj_r2 = 1 - (1 - r2) * (len(y) - 1) / max(1, len(y) - len(x_cols) - 1) if r2 is not None else None
    mse = ss_res / max(1, len(y) - len(x_cols) - 1)
    try:
        cov = mse * np.linalg.inv(x_design.T @ x_design)
        se = np.sqrt(np.maximum(np.diag(cov), 0))
    except Exception:
        se = np.full(len(coef), np.nan)
    rows = []
    for index, value in enumerate(coef):
        t_value = value / se[index] if np.isfinite(se[index]) and se[index] else None
        p_value = None
        if scipy_stats is not None and t_value is not None:
            p_value = 2 * (1 - scipy_stats.t.cdf(abs(float(t_value)), df=max(1, len(y) - len(x_cols) - 1)))
        rows.append({
            "predictor": "常数项" if index == 0 else x_cols[index - 1],
            "coefficient": round(float(value), 4),
            "se": round(float(se[index]), 4) if np.isfinite(se[index]) else None,
            "t": round(float(t_value), 4) if t_value is not None else None,
            "p": round(float(p_value), 6) if p_value is not None else None,
        })
    return {
        "dependent": y_col,
        "predictors": x_cols,
        "n": int(data.shape[0]),
        "r2": round(float(r2), 4) if r2 is not None else None,
        "adjR2": round(float(adj_r2), 4) if adj_r2 is not None else None,
        "rows": rows,
    }


def bootstrap_mediation(df: pd.DataFrame, cols: list[str], bootstrap: int = 1000) -> dict[str, Any] | None:
    if len(cols) < 3:
        return None
    x_col, m_col, y_col = cols[:3]
    data = df[[x_col, m_col, y_col]].apply(pd.to_numeric, errors="coerce").dropna()
    if data.shape[0] < 20:
        return None
    arr = data.to_numpy()
    x, m, y = arr[:, 0], arr[:, 1], arr[:, 2]
    a = ols_coef(x.reshape(-1, 1), m)[1]
    b = ols_coef(np.column_stack([x, m]), y)[2]
    c_prime = ols_coef(np.column_stack([x, m]), y)[1]
    indirect = a * b
    rng = np.random.default_rng(20260624)
    samples = []
    for _ in range(bootstrap):
        idx = rng.integers(0, len(arr), len(arr))
        sample = arr[idx]
        sx, sm, sy = sample[:, 0], sample[:, 1], sample[:, 2]
        sa = ols_coef(sx.reshape(-1, 1), sm)[1]
        sb = ols_coef(np.column_stack([sx, sm]), sy)[2]
        samples.append(sa * sb)
    low, high = np.percentile(samples, [2.5, 97.5])
    return {
        "model": "PROCESS Model 4",
        "x": x_col,
        "m": m_col,
        "y": y_col,
        "n": int(data.shape[0]),
        "a": round(float(a), 4),
        "b": round(float(b), 4),
        "c_prime": round(float(c_prime), 4),
        "indirect": round(float(indirect), 4),
        "ci95": [round(float(low), 4), round(float(high), 4)],
    }


def efa(df: pd.DataFrame, cols: list[str]) -> dict[str, Any] | None:
    if FactorAnalysis is None or len(cols) < 3:
        return None
    data = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if data.shape[0] < 10:
        return None
    n_components = max(1, min(3, len(cols) - 1))
    model = FactorAnalysis(n_components=n_components, random_state=20260624)
    loadings = model.fit(data).components_.T
    return {
        "n": int(data.shape[0]),
        "factors": n_components,
        "loadings": [
            {"variable": col, **{f"factor_{i + 1}": round(float(value), 4) for i, value in enumerate(loadings[row])}}
            for row, col in enumerate(cols)
        ],
    }


def table_text(rows: list[dict[str, Any]], columns: list[str]) -> str:
    if not rows:
        return "无可用结果。"
    return "\n".join(["\t".join(columns)] + ["\t".join("" if row.get(col) is None else str(row.get(col)) for col in columns) for row in rows])


def figure_to_data_url() -> str:
    if plt is None:
        return ""
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format="png", dpi=150)
    plt.close()
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def build_figures(df: pd.DataFrame, cols: list[str], corr: list[dict[str, Any]], anova_rows: list[dict[str, Any]], group_column: str | None) -> tuple[list[dict[str, Any]], list[str]]:
    warnings = []
    figures: list[dict[str, Any]] = []
    if plt is None:
        return figures, ["当前 Python 环境未安装 matplotlib，无法生成 PNG 图表。"]
    numeric = [col for col in cols if col in df.columns]
    if numeric:
        desc = describe(df, numeric[:8])
        if desc:
            plt.figure(figsize=(7, 4))
            labels = [row["variable"] for row in desc]
            means = [row["mean"] for row in desc]
            errors = [row["sd"] or 0 for row in desc]
            plt.bar(labels, means, yerr=errors, color="#4D7C59", alpha=0.85, capsize=3)
            plt.xticks(rotation=30, ha="right")
            plt.ylabel("Mean")
            plt.title("Descriptive Statistics")
            figures.append({
                "id": "figure_descriptive",
                "title": "图1 描述性统计均值图",
                "caption": "各数值变量均值及标准差。",
                "dataUrl": figure_to_data_url(),
            })
    if len(numeric) >= 2:
        plt.figure(figsize=(5, 4))
        corr_matrix = df[numeric[:8]].apply(pd.to_numeric, errors="coerce").corr()
        plt.imshow(corr_matrix, cmap="RdYlGn", vmin=-1, vmax=1)
        plt.colorbar(label="Pearson r")
        plt.xticks(range(len(corr_matrix.columns)), corr_matrix.columns, rotation=45, ha="right")
        plt.yticks(range(len(corr_matrix.index)), corr_matrix.index)
        plt.title("Correlation Matrix")
        figures.append({
            "id": "figure_correlation",
            "title": "图2 相关矩阵热力图",
            "caption": "Pearson 相关系数矩阵。",
            "dataUrl": figure_to_data_url(),
        })
    if anova_rows and group_column and group_column in df.columns:
        first = anova_rows[0]["variable"]
        if first in df.columns:
            data = df[[group_column, first]].dropna()
            groups = data.groupby(group_column)[first].apply(lambda s: pd.to_numeric(s, errors="coerce").dropna())
            if len(groups) >= 2:
                plt.figure(figsize=(6, 4))
                grouped_values = [
                    pd.to_numeric(part[first], errors="coerce").dropna().to_numpy()
                    for _name, part in data.groupby(group_column)
                ]
                grouped_labels = [str(name) for name, _part in data.groupby(group_column)]
                plt.boxplot(grouped_values, tick_labels=grouped_labels)
                plt.title(f"{first} by {group_column}")
                plt.ylabel(first)
                figures.append({
                    "id": "figure_anova",
                    "title": "图3 组间差异箱线图",
                    "caption": f"按 {group_column} 分组展示 {first} 的分布。",
                    "dataUrl": figure_to_data_url(),
                })
    if not figures:
        warnings.append("当前数据或分析方法没有合适的自动图表，已仅返回统计表和分析文字。")
    return figures, warnings


def main():
    payload = json.load(sys.stdin)
    df = read_frame(payload)
    df.columns = [str(col).strip() for col in df.columns]
    cols = numeric_columns(df)
    cat_cols = categorical_columns(df, cols)
    if payload.get("mode") == "profile":
        print(json.dumps({
            "ok": True,
            "sampleSize": int(len(df)),
            "columns": [str(col) for col in df.columns],
            "numericColumns": cols,
            "categoricalColumns": cat_cols,
            "previewRows": df.head(8).where(pd.notna(df.head(8)), None).to_dict(orient="records"),
        }, ensure_ascii=True))
        return

    selected_cols = plan_columns(payload, cols)
    item_cols = [col for col in selected_cols if col in cols and col[:1].upper() in {"X", "M", "Y", "V"}] or [col for col in selected_cols if col in cols] or cols
    methods = plan_methods(payload, cols, cat_cols)
    group_column = payload.get("groupColumn")
    if not group_column:
        plan = payload.get("confirmedPlan") or {}
        if isinstance(plan, dict):
            for call in plan.get("toolCalls") or []:
                if isinstance(call, dict) and isinstance(call.get("groupColumn"), str):
                    group_column = call.get("groupColumn")
                    break

    desc = describe(df, item_cols if item_cols else cols) if "descriptive" in methods else []
    corr = correlations(df, item_cols[:8]) if "correlation" in methods else []
    alpha = cronbach_alpha(df, item_cols) if "cronbach_alpha" in methods else None
    regression = linear_regression(df, item_cols[:8]) if "regression_analysis" in methods else None
    anova_rows = anova(df, item_cols[:6], str(group_column) if group_column else None) if "anova" in methods else []
    t_test_rows = independent_t_tests(df, item_cols[:6], str(group_column) if group_column else None) if "t_test" in methods else []
    mediation = bootstrap_mediation(df, item_cols) if "mediation_model_4" in methods else None
    efa_result = efa(df, item_cols) if "efa" in methods else None
    validity_rows = kmo_bartlett(df, item_cols[:10]) if ("efa" in methods or "validity_tests" in methods) else []
    lines = [
        f"样本量：{len(df)}",
        f"识别数值变量：{', '.join(cols) if cols else '无'}",
        "",
        "【描述性统计】",
        table_text(desc, ["variable", "n", "mean", "sd", "min", "max"]),
    ]
    if alpha:
        lines += ["", "【信度分析】", f"Cronbach's α={alpha['alpha']}，题项数={len(alpha['items'])}，有效样本={alpha['n']}。"]
    if corr:
        lines += ["", "【相关分析】", table_text(corr[:24], ["x", "y", "n", "r", "p"])]
    if regression:
        lines += [
            "",
            "【回归分析】",
            f"因变量：{regression['dependent']}；自变量：{'、'.join(regression['predictors'])}；R²={regression['r2']}，调整R²={regression['adjR2']}。",
            table_text(regression["rows"], ["predictor", "coefficient", "se", "t", "p"]),
        ]
    if anova_rows:
        lines += ["", "【单因素方差分析】", table_text(anova_rows, ["group", "variable", "f", "p"])]
    if t_test_rows:
        lines += ["", "【独立样本T检验】", table_text(t_test_rows, ["group", "variable", "groupA", "groupB", "meanA", "meanB", "meanDiff", "t", "p"])]
    if validity_rows:
        lines += ["", "【KMO与Bartlett检验】", table_text(validity_rows, ["test", "value", "df", "p", "interpretation"])]
    if mediation:
        lines += ["", "【Bootstrap 单一中介】", json.dumps(mediation, ensure_ascii=True)]
    if efa_result:
        lines += ["", "【探索性因子分析】", table_text(efa_result["loadings"], ["variable"] + [f"factor_{i + 1}" for i in range(efa_result["factors"])])]

    cautions = []
    if scipy_stats is None:
        cautions.append("当前 Python 环境未安装 scipy，相关和方差分析的 p 值无法计算；部署完成版请安装 server/python/requirements.txt。")
    if FactorAnalysis is None:
        cautions.append("当前 Python 环境未安装 scikit-learn，EFA 暂未运行；部署完成版请安装 server/python/requirements.txt。")
    figures, figure_warnings = build_figures(df, item_cols, corr, anova_rows, str(group_column) if group_column else (cat_cols[0] if cat_cols else None))
    cautions.extend(figure_warnings)

    tables = []
    if desc:
        tables.append({"id": "table_descriptive", "title": "描述性统计", "rows": desc, "columns": ["variable", "n", "mean", "sd", "min", "max"]})
    if corr:
        tables.append({"id": "table_correlation", "title": "相关分析", "rows": corr[:24], "columns": ["x", "y", "n", "r", "p"]})
    if regression:
        tables.append({"id": "table_regression", "title": "回归分析", "rows": regression["rows"], "columns": ["predictor", "coefficient", "se", "t", "p"]})
    if anova_rows:
        tables.append({"id": "table_anova", "title": "单因素方差分析", "rows": anova_rows, "columns": ["group", "variable", "f", "p"]})
    if t_test_rows:
        tables.append({"id": "table_t_test", "title": "独立样本T检验", "rows": t_test_rows, "columns": ["group", "variable", "groupA", "groupB", "meanA", "meanB", "meanDiff", "t", "p"]})
    if validity_rows:
        tables.append({"id": "table_validity_tests", "title": "KMO与Bartlett检验", "rows": validity_rows, "columns": ["test", "value", "df", "p", "interpretation"]})
    if mediation:
        tables.append({"id": "table_mediation", "title": "Bootstrap中介效应检验", "rows": [mediation], "columns": ["x", "m", "y", "a", "b", "c_prime", "indirect", "ci95"]})
    if efa_result:
        tables.append({"id": "table_efa", "title": "探索性因子分析", "rows": efa_result["loadings"], "columns": ["variable"] + [f"factor_{i + 1}" for i in range(efa_result["factors"])]})

    method_text = "本研究在研究方法部分采用问卷数据统计分析路径，根据变量结构开展描述统计、信度检验、KMO与Bartlett效度检验、相关分析、回归分析、差异检验、中介效应检验和探索性因子分析等计算与检验，并结合图表结果对研究问题进行解释。"
    analysis_text = "Python 已完成真实计算。写作时应基于统计表中的系数、p 值和置信区间解释结果，不应加入表中不存在的结论。"
    if corr:
        strongest = max(corr, key=lambda row: abs(float(row.get("r") or 0)))
        analysis_text = f"相关分析中，{strongest['x']} 与 {strongest['y']} 的相关系数 r={strongest['r']}，p={strongest.get('p')}。论文表述需结合研究假设判断其方向和显著性。"
    if regression:
        analysis_text = f"回归分析以 {regression['dependent']} 为因变量，纳入 {'、'.join(regression['predictors'])} 作为预测变量，模型 R²={regression['r2']}，调整R²={regression['adjR2']}。论文写作时应结合系数方向、显著性和研究假设解释影响路径。"
    if mediation:
        analysis_text = f"Bootstrap 中介模型显示间接效应为 {mediation['indirect']}，95% CI={mediation['ci95']}。若置信区间不包含 0，可作为中介效应存在的证据。"

    result = {
        "ok": True,
        "method": ",".join(methods),
        "sampleSize": int(len(df)),
        "numericColumns": cols,
        "categoricalColumns": cat_cols,
        "descriptive": desc,
        "cronbachAlpha": alpha,
        "correlations": corr,
        "regression": regression,
        "anova": anova_rows,
        "tTest": t_test_rows,
        "validityTests": validity_rows,
        "mediation": mediation,
        "efa": efa_result,
        "tables": tables,
        "figures": figures,
        "methodText": method_text,
        "analysisText": analysis_text,
        "cautions": cautions,
        "plainText": "\n".join(lines),
    }
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True))
        sys.exit(1)
