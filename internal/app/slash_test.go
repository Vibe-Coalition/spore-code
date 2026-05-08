package app

import "testing"

func TestModelsPresetAppearsInSlashAutocomplete(t *testing.T) {
	m := inputTestModel(t)
	m.input.SetValue("/models")
	m.refreshSuggest()

	if !m.suggest.visible {
		t.Fatal("expected slash suggestions to be visible")
	}
	for _, match := range m.suggest.matches {
		if match.cmd == "/models_preset" {
			return
		}
	}
	t.Fatalf("expected /models_preset suggestion, got %#v", m.suggest.matches)
}

func TestModelsPresetAutocompleteShowsPresetNamesBeforeSpace(t *testing.T) {
	m := inputTestModel(t)
	m.presetNames = []string{"fast", "balanced"}
	m.input.SetValue("/models")
	m.refreshSuggest()

	for _, match := range m.suggest.matches {
		if match.cmd == "/models_preset fast" {
			return
		}
	}
	t.Fatalf("expected fetched preset suggestions before argument space, got %#v", m.suggest.matches)
}

func TestModelsPresetAutocompleteShowsPresetNamesAtCommand(t *testing.T) {
	m := inputTestModel(t)
	m.presetNames = []string{"fast", "balanced"}
	m.input.SetValue("/models_preset")
	m.refreshSuggest()

	for _, match := range m.suggest.matches {
		if match.cmd == "/models_preset balanced" {
			return
		}
	}
	t.Fatalf("expected fetched preset suggestions at command boundary, got %#v", m.suggest.matches)
}

func TestModelsPresetAutocompleteUsesFetchedPresetNames(t *testing.T) {
	m := inputTestModel(t)
	m.presetNames = []string{"fast", "balanced"}
	m.input.SetValue("/models_preset f")
	m.refreshSuggest()

	if len(m.suggest.matches) != 1 || m.suggest.matches[0].cmd != "/models_preset fast" {
		t.Fatalf("expected fetched preset suggestion, got %#v", m.suggest.matches)
	}
}

func TestModelsPresetAutocompleteOffersServerReset(t *testing.T) {
	m := inputTestModel(t)
	m.input.SetValue("/models_preset ")
	m.refreshSuggest()

	for _, match := range m.suggest.matches {
		if match.cmd == "/models_preset server" {
			return
		}
	}
	t.Fatalf("expected /models_preset server suggestion, got %#v", m.suggest.matches)
}
