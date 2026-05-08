//go:build !cgo

package codeindex

import (
	"regexp"
	"strings"
)

func init() {
	RegisterExtractor(fallbackExtractor{lang: LangTS})
	RegisterExtractor(fallbackExtractor{lang: LangJS})
	RegisterExtractor(fallbackExtractor{lang: LangPython})
	RegisterExtractor(fallbackExtractor{lang: LangRust})
}

// fallbackExtractor keeps the code index package buildable in pure-Go builds.
// It intentionally extracts only conservative top-level symbols/imports. The
// richer tree-sitter extractor is used automatically when building with CGO.
type fallbackExtractor struct{ lang string }

func (e fallbackExtractor) Language() string { return e.lang }

func (e fallbackExtractor) Extract(fe FileEntry, src []byte) ExtractResult {
	s := string(src)
	path := fe.RelPath
	switch e.lang {
	case LangPython:
		return extractPythonFallback(path, s)
	case LangRust:
		return extractRustFallback(path, s)
	case LangTS, LangJS:
		return extractScriptFallback(path, s, e.lang)
	default:
		return ExtractResult{}
	}
}

var (
	scriptDeclRe  = regexp.MustCompile(`(?m)^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(`)
	scriptClassRe = regexp.MustCompile(`(?m)^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)`)
	scriptVarRe   = regexp.MustCompile(`(?m)^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^\n)]*\)|[A-Za-z_$][\w$]*)\s*=>`)
	scriptImport  = regexp.MustCompile(`(?m)^\s*import\s+(?:.+?\s+from\s+)?["']([^"']+)["']`)
	pyFuncRe      = regexp.MustCompile(`(?m)^def\s+([A-Za-z_]\w*)\s*\(`)
	pyClassRe     = regexp.MustCompile(`(?m)^class\s+([A-Za-z_]\w*)\s*[:(]`)
	pyImportRe    = regexp.MustCompile(`(?m)^(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))`)
	rustItemRe    = regexp.MustCompile(`(?m)^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z_]\w*)`)
	rustUseRe     = regexp.MustCompile(`(?m)^\s*use\s+([^;]+);`)
)

func extractScriptFallback(path, src string, lang string) ExtractResult {
	var out ExtractResult
	for _, m := range scriptDeclRe.FindAllStringSubmatchIndex(src, -1) {
		out.Symbols = append(out.Symbols, fallbackSymbol(path, src, m, 1, "function", lang, ""))
	}
	for _, m := range scriptClassRe.FindAllStringSubmatchIndex(src, -1) {
		out.Symbols = append(out.Symbols, fallbackSymbol(path, src, m, 1, "class", lang, ""))
	}
	for _, m := range scriptVarRe.FindAllStringSubmatchIndex(src, -1) {
		out.Symbols = append(out.Symbols, fallbackSymbol(path, src, m, 1, "function", lang, ""))
	}
	for _, m := range scriptImport.FindAllStringSubmatchIndex(src, -1) {
		out.Imports = append(out.Imports, ExtractedImport{Target: src[m[2]:m[3]], Line: fallbackLine(src, m[0])})
	}
	return out
}

func extractPythonFallback(path, src string) ExtractResult {
	var out ExtractResult
	for _, m := range pyFuncRe.FindAllStringSubmatchIndex(src, -1) {
		out.Symbols = append(out.Symbols, fallbackSymbol(path, src, m, 1, "function", LangPython, ""))
	}
	for _, m := range pyClassRe.FindAllStringSubmatchIndex(src, -1) {
		out.Symbols = append(out.Symbols, fallbackSymbol(path, src, m, 1, "class", LangPython, ""))
	}
	for _, m := range pyImportRe.FindAllStringSubmatchIndex(src, -1) {
		if m[2] >= 0 {
			out.Imports = append(out.Imports, ExtractedImport{Target: src[m[2]:m[3]], Line: fallbackLine(src, m[0])})
		} else if m[4] >= 0 {
			out.Imports = append(out.Imports, ExtractedImport{Target: src[m[4]:m[5]], Line: fallbackLine(src, m[0])})
		}
	}
	return out
}

func extractRustFallback(path, src string) ExtractResult {
	var out ExtractResult
	for _, m := range rustItemRe.FindAllStringSubmatchIndex(src, -1) {
		kind := "function"
		switch src[m[2]:m[3]] {
		case "struct":
			kind = "struct"
		case "enum":
			kind = "enum"
		case "trait":
			kind = "interface"
		case "type":
			kind = "type"
		}
		out.Symbols = append(out.Symbols, fallbackSymbol(path, src, m, 2, kind, LangRust, ""))
	}
	for _, m := range rustUseRe.FindAllStringSubmatchIndex(src, -1) {
		out.Imports = append(out.Imports, ExtractedImport{Target: strings.TrimSpace(src[m[2]:m[3]]), Line: fallbackLine(src, m[0])})
	}
	return out
}

func fallbackSymbol(path, src string, match []int, group int, kind string, lang string, container string) Symbol {
	name := src[match[group*2]:match[group*2+1]]
	line := fallbackLine(src, match[0])
	return Symbol{
		QName:     makeQName(path, container, name),
		Name:      name,
		Kind:      kind,
		File:      path,
		StartLine: line,
		EndLine:   line,
		Signature: strings.TrimSpace(firstLine(src[match[0]:match[1]])),
		Container: container,
		Language:  lang,
		Exported:  isExportedIdent(name),
	}
}

func fallbackLine(src string, offset int) int {
	return strings.Count(src[:offset], "\n") + 1
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
