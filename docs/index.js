

let oldCode;
let editor;

function applyLargeFileMode(ed, bytes) {
    const BIG = 1_500_000;   // ~1.5 MB
    const HUGE = 4_000_000;  // ~4 MB

    // Always good perf tweaks
    ed.setOptions({
        animatedScroll: false,
        highlightActiveLine: false,
        highlightGutterLine: false,
        showPrintMargin: false,
        displayIndentGuides: false,
        useSoftTabs: true,
        wrap: false,                  // avoid reflow work on long lines
        cursorStyle: "slim"
    });

    if (bytes > BIG) {
        ed.session.setUseWorker(false);        // disable background tokenizer/linter
        ed.setOption("enableBasicAutocompletion", false);
        ed.setOption("enableLiveAutocompletion", false);
        ed.setOption("enableSnippets", false);
    }

    if (bytes > HUGE) {
        // As a last resort for huge files, drop syntax coloring
        ed.session.setMode("ace/mode/text");
    }
}
function setLanguage(lang){ // java / csharp / kotlin
    editor.session.setMode("ace/mode/" + lang);
    console.log("Changed language to: " + lang)
    const langDiv = document.getElementById("language");
    const langButtons = langDiv.getElementsByTagName("button");
    for (let i = 0; i < langButtons.length; i++) {
        langButtons[i].classList.remove("selected");
    }
    const button = document.getElementById(lang);
    button.classList.add("selected");
    window.currentLang = lang;
}


const extToMode = {
    ".cs": "ace/mode/csharp",
    ".java": "ace/mode/java",
    ".kt": "ace/mode/kotlin",
    ".kts": "ace/mode/kotlin",
    ".json": "ace/mode/json",
    ".xml": "ace/mode/xml",
    ".html": "ace/mode/html",
    ".js": "ace/mode/javascript",
    ".ts": "ace/mode/typescript",
    ".md": "ace/mode/markdown",
    ".txt": "ace/mode/text"
};

function detectModeFromName(name) {
    const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
    return m ? (extToMode[m[0]] || "ace/mode/text") : "ace/mode/text";
}

function normalizeNewlines(s) {
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function pickFile(){
    // handle file uploading
    const fileInput = document.getElementById('fileInput')
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const text = await file.text();
        const code = normalizeNewlines(text);
        const mode = detectModeFromName(file.name);


        // in case of large file, turn off editor coloring to improve performance
        editor.session.setMode(mode);
        applyLargeFileMode(editor, file.size);
        oldCode = code;
        editor.setValue(code, -1);  // -1 to keep cursor at top

        // autofill file path
        const fp = document.getElementById('filePath');
        if (fp && !fp.value) fp.value = file.name.replace(/^.*\//, "");
    };
    fileInput.click();
}

function submit() {

    if (typeof Diff === "undefined") { alert("Diff library not available."); return; }
    // create diff and pulls context to form the llm prompt
    const originalCode = (typeof oldCode === "string") ? oldCode : "";    const newCode = editor.getValue();
    const langMode = (window.currentLang) || "java";
    const langToExt = {java: ".java", csharp: ".cs", kotlin: ".kt"};
    const langLabel = ({java: "Java", csharp: "C#", kotlin: "Kotlin"}[langMode]) || "Code";
    const patch = Diff.createTwoFilesPatch(
        `a/File${langToExt[langMode]}`,
        `b/File${langToExt[langMode]}`,
        originalCode, newCode
    );

    const filePath = (document.getElementById("filePath")?.value || `src/File.${langMode === "csharp" ? "cs" : langMode === "java" ? "java" : "kt"}`).replace(/^\/+/, "");
    const editorconfig = (document.getElementById("editorconfig")?.value || "").trim();
    const perfHints = (document.getElementById("perfHints")?.value || "").trim();
    const commitMsg = (document.getElementById("commitMsg")?.value || "").trim();


    const llmPrompt = (
`ROLE
You are a senior ${langLabel} reviewer inside a deterministic code-style tool.
Your job is to analyze the following code modification and classify it in terms of readability, safety, performance, style-consistency, and correctness.  
Your output must be fully deterministic and never subjective or creative.

------------------------
CONTEXT
------------------------
File path: "${filePath}",
Language: "${langLabel}",
.editorconfig (optional):
${editorconfig}

Performance hints (optional):
${perfHints}

Commit message (optional):
${commitMsg}


------------------------
UNIFIED DIFF
------------------------
${patch}

------------------------
ANALYSIS INSTRUCTIONS (IMPORTANT)
------------------------

1. Assess the diff with respect to:
   - Readability and cognitive load (nesting, feature stacking, terse syntax)
   - Safety and correctness (nullability, contracts, exceptions)
   - Performance impact relative to provided hints
   - Style consistency:
       • Follow .editorconfig if present  
       • Otherwise follow common idioms in ${langLabel}  
       • DO NOT introduce subjective taste
   - API stability (signature changes, visibility changes)

2. Use ONLY evidence found in the diff and context.
   - Cite specific diff lines using "+", "-", "@@".
   - NEVER invent code that is not shown.
   - If uncertain, explicitly say "uncertain".

3. Minimal patch rule:
   - If undesired, propose the SMALLEST possible unified diff fix.
   - Do NOT reformat, rename, fold code, inline code, or rewrite blocks unless directly required for correctness or clarity.
   - Do NOT modify lines outside the presented diff.

4. Forbidden behaviors:
   - No personal opinions ("looks nicer", "I prefer")
   - No creative rewrites
   - No unrelated optimizations
   - No restyling unless linked to a violated rule
   - No commentary outside the JSON

5. Scoring rubric (0.0–1.0):
   - 1.0 = excellent, no concerns
   - 0.5 = uncertain, borderline, or mixed
   - 0.0 = clear violation or severe issue

6. Feature interaction analysis:
   - Identify any risky feature combinations (pattern matching, null-coalescing, chained calls, nested ternaries, deferred execution, implicit conversions).
   - If none, return an empty array.

------------------------
OUTPUT (STRICT JSON)
------------------------
{
"language": ${langLabel},
"file_path": ${filePath},

"intent": "one sentence describing likely intent",
"touched_symbols": [
{ "name": "string", "kind": "class|method|field|property|enum|interface|other", "change": "added|modified|removed|signature_changed|cosmetic", "behavior_affecting": true }
],

"category_assessments": {
"readability": { "score": 0.0, "notes": "string", "citations": ["@@ -a,b +c,d @@", "+12"] },
"safety":      { "score": 0.0, "notes": "string", "citations": [] },
"performance": { "score": 0.0, "notes": "string", "citations": [] },
"api":         { "score": 0.0, "notes": "string", "citations": [] },
"style":       { "score": 0.0, "notes": "string", "citations": [] }
},

"findings": [
{
  "id": "F1",
  "category": "readability|safety|performance|api|style",
  "severity": "info|minor|major|critical",
  "text": "actionable, grounded finding",
  "citations": ["@@ -a,b +c,d @@", "+N", "-M"]
}
],

"risky_feature_combinations": [
"e.g., pattern matching + null-coalescing + nested ternary"
],

"suggested_minimal_patch": "unified diff string or empty string",
"developer_actions": [
"bullet point, actionable step tied to a finding"
],

"verdict": "desired|undesired|uncertain",
"summary": "one sentence (<120 chars)",
"overall_confidence": 0.0,
"notes": "string or empty"
}
Return ONLY the JSON object. 
Do not add explanations, headers, or markdown.`).trim();


    const $pre = document.getElementById("promptOutput");
    $pre.textContent = llmPrompt;

    // copy
    document.getElementById('copyPrompt').onclick = async () => {
        await navigator.clipboard.writeText($pre.textContent);
        document.getElementById('copyPrompt').classList.add('copied');
        setTimeout(() => document.getElementById('copyPrompt').classList.remove('copied'), 600);
    };

    // download
    document.getElementById('downloadPrompt').onclick = () => {
        const blob = new Blob([$pre.textContent], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'llm-prompt.txt';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // wrap toggle
    const $wrap = document.getElementById('wrapToggle');
    const setWrap = (on) => {
        $pre.style.whiteSpace = on ? 'pre-wrap' : 'pre';
    };
    $wrap.onchange = () => setWrap($wrap.checked);
    setWrap($wrap.checked);


}




document.addEventListener("DOMContentLoaded", () => {


    // init from system or saved choice
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = localStorage.getItem('theme')
        || (prefersDark ? 'dark' : 'light');

    document.getElementById('themeToggle').addEventListener('click', () => {
        const root = document.documentElement;
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        localStorage.setItem('theme', next);
        applyTheme(next);

    });

    ace.config.set("basePath", "https://cdn.jsdelivr.net/npm/ace-builds@1.36.0/src-min-noconflict");

    // init editor
    editor = ace.edit('editor',{
        mode: "ace/mode/java",
        theme: "ace/theme/monokai",
        value: "class A {\n\n}"

    });

    // setup editor theme
    const LIGHT_ACE_THEME = "ace/theme/chrome";   // nice light theme
    const DARK_ACE_THEME  = "ace/theme/monokai";  // your current dark

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        const aceTheme = theme === "dark" ? DARK_ACE_THEME : LIGHT_ACE_THEME;
        editor.setTheme(aceTheme);
        localStorage.setItem("theme", theme);
    }

    // init (keep your system-pref check if you have it)
    applyTheme(localStorage.getItem("theme") || "light");



    setLanguage("java")


});
