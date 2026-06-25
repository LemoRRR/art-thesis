#!/usr/bin/env python3
import base64
import io
import json
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
    if isinstance(calls, list):
        for call in calls:
            if isinstance(call, dict) and isinstance(call.get("tool"), str):
                methods.append(call["tool"])
    if isinstance(plan, dict):
        raw_methods = plan.get("methods")
        if isinstance(raw_methods, list):
            methods += [str(item) for item in raw_methods]
        if isinstance(plan.get("method"), str):
            methods.append(str(plan["method"]))
    if isinstance(payload.get("method"), str):
        methods.append(str(payload["method"]))
    if not methods:
        methods = ["descriptive"]
        if len(numeric) >= 2:
            methods.append("correlation")
        if len(numeric) >= 3:
            methods.append("cronbach_alpha")
        if categorical:
            methods.append("anova")
    allowed = ["descriptive", "cronbach_alpha", "correlation", "anova", "mediation_model_4", "efa"]
    unique = []
    for method in methods:
        normalized = {
            "cronbach": "cronbach_alpha",
            "alpha": "cronbach_alpha",
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


def ols_coef(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    x_design = np.column_stack([np.ones(len(x)), x])
    coef, *_ = np.linalg.lstsq(x_design, y, rcond=None)
    return coef


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
        }, ensure_ascii=False))
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
    anova_rows = anova(df, item_cols[:6], str(group_column) if group_column else None) if "anova" in methods else []
    mediation = bootstrap_mediation(df, item_cols) if "mediation_model_4" in methods else None
    efa_result = efa(df, item_cols) if "efa" in methods else None

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
    if anova_rows:
        lines += ["", "【单因素方差分析】", table_text(anova_rows, ["group", "variable", "f", "p"])]
    if mediation:
        lines += ["", "【Bootstrap 单一中介】", json.dumps(mediation, ensure_ascii=False)]
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
    if anova_rows:
        tables.append({"id": "table_anova", "title": "单因素方差分析", "rows": anova_rows, "columns": ["group", "variable", "f", "p"]})
    if efa_result:
        tables.append({"id": "table_efa", "title": "探索性因子分析", "rows": efa_result["loadings"], "columns": ["variable"] + [f"factor_{i + 1}" for i in range(efa_result["factors"])]})

    method_text = "本次分析采用 Python 统计工具箱执行，按照用户确认的分析方案完成数据读取、变量映射、统计检验和图表生成。"
    if payload.get("confirmedPlan") and isinstance(payload["confirmedPlan"], dict):
        method_text = str(payload["confirmedPlan"].get("formula") or method_text)
    analysis_text = "Python 已完成真实计算。写作时应基于统计表中的系数、p 值和置信区间解释结果，不应加入表中不存在的结论。"
    if corr:
        strongest = max(corr, key=lambda row: abs(float(row.get("r") or 0)))
        analysis_text = f"相关分析中，{strongest['x']} 与 {strongest['y']} 的相关系数 r={strongest['r']}，p={strongest.get('p')}。论文表述需结合研究假设判断其方向和显著性。"
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
        "anova": anova_rows,
        "mediation": mediation,
        "efa": efa_result,
        "tables": tables,
        "figures": figures,
        "methodText": method_text,
        "analysisText": analysis_text,
        "cautions": cautions,
        "plainText": "\n".join(lines),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
