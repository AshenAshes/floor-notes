import { App, PluginSettingTab, Setting } from "obsidian";
import type FloorNotesPlugin from "../main";
import {
  applyThemeClasses,
  isFloorNotesMode,
  supportsExplicitMode,
  THEME_OPTIONS
} from "../theme";
import { t } from "../util/locale";
import {
  FloorNotesSettings,
  isDefaultSortOrder,
  isLocale,
  isPreferredNewline,
  isThreadViewStyle,
  THREAD_VIEW_STYLES,
  ThreadViewStyle
} from "./types";

type RedrawnControl = "locale" | "theme" | "mode";

type DeclarativeSettingControl =
  | {
      type: "dropdown";
      key: keyof FloorNotesSettings;
      options: Record<string, string>;
      disabled?: boolean | (() => boolean);
    }
  | {
      type: "toggle";
      key: keyof FloorNotesSettings;
      disabled?: boolean | (() => boolean);
    };

type DeclarativeSettingDefinitionBase = {
  name: string;
  desc?: string;
};

type DeclarativeSettingDefinition =
  | (DeclarativeSettingDefinitionBase & {
      control: DeclarativeSettingControl;
      render?: never;
    })
  | (DeclarativeSettingDefinitionBase & {
      control?: never;
      render: (setting: Setting, group: unknown) => void | (() => void);
    });

type DeclarativeSettingGroup = {
  type: "group";
  heading?: string;
  items: DeclarativeSettingDefinition[];
};

type DeclarativeSettingItem = DeclarativeSettingDefinition | DeclarativeSettingGroup;

export class FloorNotesSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: FloorNotesPlugin
  ) {
    super(app, plugin);
  }

  public getSettingDefinitions(): DeclarativeSettingItem[] {
    const hasExplicitMode = supportsExplicitMode(this.plugin.settings.theme);

    return [
      {
        type: "group",
        heading: t("settingsTitle"),
        items: [
          {
            name: t("settingsSortOrder"),
            control: {
              type: "dropdown",
              key: "defaultSortOrder",
              options: {
                asc: t("ascending"),
                desc: t("descending")
              }
            }
          },
          {
            name: t("settingsPreferredEol"),
            control: {
              type: "dropdown",
              key: "preferredNewline",
              options: {
                auto: t("auto"),
                LF: "LF",
                CRLF: "CRLF"
              }
            }
          },
          {
            name: t("settingsLocale"),
            control: {
              type: "dropdown",
              key: "locale",
              options: {
                auto: t("auto"),
                en: "English",
                "zh-cn": "简体中文"
              }
            }
          },
          {
            name: t("settingsTheme"),
            render: (setting) => this.renderThemeSetting(setting)
          },
          {
            name: t("settingsMode"),
            ...(hasExplicitMode ? {} : { desc: t("settingsModeDescObsidian") }),
            control: {
              type: "dropdown",
              key: "mode",
              options: {
                auto: hasExplicitMode ? t("auto") : t("settingsModeDescObsidian"),
                light: t("light"),
                dark: t("dark")
              },
              disabled: () => !supportsExplicitMode(this.plugin.settings.theme)
            }
          },
          {
            name: t("settingsDefaultViewStyle"),
            desc: t("settingsDefaultViewStyleDesc"),
            control: {
              type: "dropdown",
              key: "defaultViewStyle",
              options: {
                bubble: t("bubbleStyle"),
                glass: t("glassStyle"),
                paper: t("paperStyle"),
                timeline: t("timelineStyle")
              }
            }
          },
          {
            name: t("settingsShowImageDescriptions"),
            desc: t("settingsShowImageDescriptionsDesc"),
            control: {
              type: "toggle",
              key: "showImageDescriptions"
            }
          },
          {
            name: t("settingsRestoreLastViewPosition"),
            desc: t("settingsRestoreLastViewPositionDesc"),
            control: {
              type: "toggle",
              key: "restoreLastViewPosition"
            }
          },
          {
            name: t("settingsAutoOpen"),
            desc: t("settingsAutoOpenDesc"),
            control: {
              type: "toggle",
              key: "autoOpenThreadView"
            }
          }
        ]
      }
    ];
  }

  public getControlValue(key: string): unknown {
    switch (key) {
      case "preferredNewline":
        return this.plugin.settings.preferredNewline;
      case "defaultSortOrder":
        return this.plugin.settings.defaultSortOrder;
      case "locale":
        return this.plugin.settings.locale;
      case "theme":
        return this.plugin.settings.theme;
      case "mode":
        return this.plugin.settings.mode;
      case "autoOpenThreadView":
        return this.plugin.settings.autoOpenThreadView;
      case "showImageDescriptions":
        return this.plugin.settings.showImageDescriptions;
      case "restoreLastViewPosition":
        return this.plugin.settings.restoreLastViewPosition;
      case "defaultViewStyle":
        return this.plugin.settings.defaultViewStyle;
      default:
        return undefined;
    }
  }

  public setControlValue(key: string, value: unknown): void {
    switch (key) {
      case "preferredNewline":
        if (isPreferredNewline(value)) {
          void this.plugin.updateSettings({ preferredNewline: value });
        }
        break;
      case "defaultSortOrder":
        if (isDefaultSortOrder(value)) {
          void this.plugin.updateSettings({ defaultSortOrder: value });
        }
        break;
      case "locale":
        if (isLocale(value)) {
          void this.plugin.updateSettings({ locale: value });
        }
        break;
      case "mode":
        if (isFloorNotesMode(value)) {
          void this.plugin.updateSettings({ mode: value });
        }
        break;
      case "defaultViewStyle":
        if (isThreadViewStyle(value)) {
          void this.plugin.updateSettings({ defaultViewStyle: value });
        }
        break;
      case "autoOpenThreadView":
        if (typeof value === "boolean") {
          void this.plugin.updateSettings({ autoOpenThreadView: value });
        }
        break;
      case "showImageDescriptions":
        if (typeof value === "boolean") {
          void this.plugin.updateSettings({ showImageDescriptions: value });
        }
        break;
      case "restoreLastViewPosition":
        if (typeof value === "boolean") {
          void this.plugin.updateSettings({ restoreLastViewPosition: value });
        }
        break;
      default:
        return;
    }

    this.refreshDeclarativeSettings();
  }

  public display(): void {
    const { containerEl } = this;
    const focusedControl = this.getFocusedControl();
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
        dropdown.selectEl.dataset.floorNotesSettingsControl = "locale";
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

    this.renderThemeSetting(new Setting(containerEl));

    const hasExplicitMode = supportsExplicitMode(this.plugin.settings.theme);
    const modeSetting = new Setting(containerEl)
      .setName(t("settingsMode"));

    if (!hasExplicitMode) {
      modeSetting.setDesc(t("settingsModeDescObsidian"));
    }

    modeSetting.addDropdown((dropdown) => {
      dropdown.selectEl.dataset.floorNotesSettingsControl = "mode";
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
      .setName(t("settingsShowImageDescriptions"))
      .setDesc(t("settingsShowImageDescriptionsDesc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showImageDescriptions)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ showImageDescriptions: value });
          });
      });

    new Setting(containerEl)
      .setName(t("settingsRestoreLastViewPosition"))
      .setDesc(t("settingsRestoreLastViewPositionDesc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.restoreLastViewPosition)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ restoreLastViewPosition: value });
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

    this.restoreFocus(focusedControl);
  }

  private renderThemeSetting(setting: Setting): () => void {
    setting
      .setName(t("settingsTheme"))
      .settingEl.classList.add("floor-notes-theme-setting");
    const themeGrid = setting.controlEl.createDiv({ cls: "floor-notes-theme-grid" });
    themeGrid.setAttribute("role", "radiogroup");
    themeGrid.setAttribute("aria-label", t("settingsTheme"));
    const cleanupCallbacks: (() => void)[] = [];

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
      input.dataset.floorNotesSettingsControl = "theme";
      const handleChange = () => {
        if (input.checked) {
          void this.updateTheme(theme.id);
        }
      };
      input.addEventListener("change", handleChange);
      cleanupCallbacks.push(() => input.removeEventListener("change", handleChange));

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

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    };
  }

  private refreshDeclarativeSettings(): boolean {
    const tab = this as unknown as { update?: () => void };
    if (typeof tab.update !== "function") {
      return false;
    }
    tab.update();
    return true;
  }

  private getFocusedControl(): RedrawnControl | null {
    const activeElement = this.containerEl.ownerDocument.activeElement;
    if (!(activeElement instanceof HTMLElement) || !this.containerEl.contains(activeElement)) {
      return null;
    }

    const control = activeElement.closest<HTMLElement>("[data-floor-notes-settings-control]");
    const controlName = control?.dataset.floorNotesSettingsControl;
    return controlName === "locale" || controlName === "theme" || controlName === "mode"
      ? controlName
      : null;
  }

  private restoreFocus(control: RedrawnControl | null): void {
    if (!control) {
      return;
    }

    const selector = control === "theme"
      ? `[data-floor-notes-settings-control="${control}"]:checked`
      : `[data-floor-notes-settings-control="${control}"]`;
    this.containerEl.querySelector<HTMLElement>(selector)?.focus();
  }

  private async updateTheme(theme: (typeof THEME_OPTIONS)[number]["id"]): Promise<void> {
    await this.plugin.updateSettings({ theme });
    if (!this.refreshDeclarativeSettings()) {
      this.display();
    }
  }
}
