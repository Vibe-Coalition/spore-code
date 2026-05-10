package shellcmd

import "strings"

// WindowsCmdLine builds the raw command line passed to cmd.exe.
//
// Go's generic Windows argv quoting is compatible with CommandLineToArgvW,
// but cmd.exe has its own /C parsing rules. Passing the user's command as a
// normal argv item can strip embedded quotes before tools like git see them.
// Supplying the exact command line keeps quoted arguments stable, e.g.
//
//	git commit -m "message with spaces"
func WindowsCmdLine(shell, command string) string {
	shell = strings.TrimSpace(shell)
	if shell == "" {
		shell = "cmd.exe"
	}
	command = strings.TrimRight(command, "\r\n")
	return quoteWindowsArg(shell) + " /D /S /C " + quoteCmdC(command)
}

func quoteCmdC(command string) string {
	return `"` + command + `"`
}

func quoteWindowsArg(arg string) string {
	if arg == "" {
		return `""`
	}
	if !strings.ContainsAny(arg, " \t\"") {
		return arg
	}

	var b strings.Builder
	b.WriteByte('"')
	backslashes := 0
	for _, r := range arg {
		switch r {
		case '\\':
			backslashes++
		case '"':
			b.WriteString(strings.Repeat("\\", backslashes*2+1))
			b.WriteByte('"')
			backslashes = 0
		default:
			if backslashes > 0 {
				b.WriteString(strings.Repeat("\\", backslashes))
				backslashes = 0
			}
			b.WriteRune(r)
		}
	}
	if backslashes > 0 {
		b.WriteString(strings.Repeat("\\", backslashes*2))
	}
	b.WriteByte('"')
	return b.String()
}
