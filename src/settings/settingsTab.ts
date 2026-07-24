import { App, PluginSettingTab, Setting } from "obsidian";
import type FloorNotesPlugin from "../main";
import { applyThemeClasses, supportsExplicitMode, THEME_OPTIONS } from "../theme";
import { t } from "../util/locale";
import { THREAD_VIEW_STYLES, ThreadViewStyle } from "./types";

export class FloorNotesSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: FloorNotesPlugin
  ) {
    super(app, plugin);
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setHeading()
      .setName(t("settingsTitle"));

    new Setting(containerEl)
      .setName(t("settingsSortOrder"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("asc", t("ascending"))
          .addOption("desc", t("descending"))
          .setValue(this.plugin.settings.defaultSortOrder)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ defaultSortOrder: value as "asc" | "desc" });
          });
      });

    new Setting(containerEl)
      .setName(t("settingsPreferredEol"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", t("auto"))
          .addOption("LF", "LF")
          .addOption("CRLF", "CRLF")
          .setValue(this.plugin.settings.preferredNewline)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ preferredNewline: value as "LF" | "CRLF" | "auto" });
          });
      });

    new Setting(containerEl)
      .setName(t("settingsLocale"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", t("auto"))
          .addOption("en", "English")
          .addOption("zh-cn", "简体中文")
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ locale: value as "en" | "zh-cn" | "auto" });
            this.display();
          });
      });

    const themeSetting = new Setting(containerEl)
      .setName(t("settingsTheme"));
    themeSetting.settingEl.classList.add("floor-notes-theme-setting");
    const themeGrid = themeSetting.controlEl.createDiv({ cls: "floor-notes-theme-grid" });
    themeGrid.setAttribute("role", "radiogroup");
    themeGrid.setAttribute("aria-label", t("settingsTheme"));

    for (const theme of THEME_OPTIONS) {
      const inputId = `floor-notes-theme-${theme.id}`;
      const choice = themeGrid.createDiv({ cls: "floor-notes-theme-choice" });
      const input = choice.createEl("input", {
        cls: "floor-notes-theme-input",
        attr: {
          type: "radio",
          id: inputId,
          name: "floor-notes-theme",
          value: theme.id
        }
      });
      input.checked = this.plugin.settings.theme === theme.id;
      input.addEventListener("change", () => {
        if (!input.checked) {
          return;
        }
        void this.updateTheme(theme.id);
      });

      const option = choice.createEl("label", {
        cls: "floor-notes-theme-option",
        attr: { for: inputId }
      });
      option.createSpan({ cls: "floor-notes-theme-option-name", text: t(theme.labelKey) });

      const preview = option.createDiv({ cls: "floor-notes-theme-preview" });
      preview.setAttribute("aria-hidden", "true");
      applyThemeClasses(preview, theme.id, this.plugin.settings.mode);

      if (theme.id === "custom") {
        preview.classList.add("is-custom-preview");
        for (const style of THREAD_VIEW_STYLES) {
          const swatch = preview.createDiv({ cls: "floor-notes-theme-custom-swatch" });
          applyThemeClasses(swatch, theme.id, this.plugin.settings.mode);
          swatch.classList.add(`floor-notes-view-style-${style}`);
          swatch.createSpan({ cls: "floor-notes-theme-custom-swatch-title" });
          swatch.createSpan({ cls: "floor-notes-theme-custom-swatch-line" });
          swatch.createSpan({ cls: "floor-notes-theme-custom-swatch-accent" });
        }
        continue;
      }

      const previewHeader = preview.createDiv({ cls: "floor-notes-theme-preview-header" });
      previewHeader.createSpan({ cls: "floor-notes-theme-preview-title" });
      previewHeader.createSpan({ cls: "floor-notes-theme-preview-dot" });
      const previewContent = preview.createDiv({ cls: "floor-notes-theme-preview-content" });
      previewContent.createSpan({ cls: "floor-notes-theme-preview-line is-primary" });
      previewContent.createSpan({ cls: "floor-notes-theme-preview-line is-muted" });
      previewContent.createSpan({ cls: "floor-notes-theme-preview-line is-accent" });
    }

    const hasExplicitMode = supportsExplicitMode(this.plugin.settings.theme);
    const modeSetting = new Setting(containerEl)
      .setName(t("settingsMode"));

    if (!hasExplicitMode) {
      modeSetting.setDesc(t("settingsModeDescObsidian"));
    }

    modeSetting.addDropdown((dropdown) => {
      dropdown
        .addOption("auto", hasExplicitMode ? t("auto") : t("settingsModeDescObsidian"))
        .addOption("light", t("light"))
        .addOption("dark", t("dark"))
        .setValue(hasExplicitMode ? this.plugin.settings.mode : "auto")
        .setDisabled(!hasExplicitMode)
        .onChange(async (value) => {
          await this.plugin.updateSettings({ mode: value as "auto" | "light" | "dark" });
          this.display();
        });
    });

    new Setting(containerEl)
      .setName(t("settingsDefaultViewStyle"))
      .setDesc(t("settingsDefaultViewStyleDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("bubble", t("bubbleStyle"))
          .addOption("glass", t("glassStyle"))
          .addOption("paper", t("paperStyle"))
          .addOption("timeline", t("timelineStyle"))
          .setValue(this.plugin.settings.defaultViewStyle)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ defaultViewStyle: value as ThreadViewStyle });
          });
      });

    new Setting(containerEl)
      .setName(t("settingsAutoOpen"))
      .setDesc(t("settingsAutoOpenDesc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.autoOpenThreadView)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ autoOpenThreadView: value });
          });
      });
  }

  private async updateTheme(theme: (typeof THEME_OPTIONS)[number]["id"]): Promise<void> {
    await this.plugin.updateSettings({ theme });
    this.display();
  }
}
