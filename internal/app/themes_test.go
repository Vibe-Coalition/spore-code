package app

import "testing"

func TestThemeNamesExposeOnlyCurrentCoreThemes(t *testing.T) {
	got := ThemeNames()
	want := []string{"dark", "light"}
	if len(got) != len(want) {
		t.Fatalf("theme count mismatch: got %#v want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("theme names mismatch: got %#v want %#v", got, want)
		}
	}
}

func TestLegacyThemeNamesNormalizeToDark(t *testing.T) {
	if got := themeForName("oak").Name; got != "dark" {
		t.Fatalf("legacy theme should normalize to dark, got %q", got)
	}
	if isThemeName("oak") {
		t.Fatalf("legacy theme should not be exposed as selectable")
	}
}
