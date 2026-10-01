import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type ProposalPlugin from './main';

export interface ProposalSettings { readLimitWords: number }
export const DEFAULT_SETTINGS: ProposalSettings = { readLimitWords: 2000 };

export class ProposalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ProposalPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{ name: 'Full read word limit',
			desc: 'At this word count, tools return an outline instead of the full note. Words are counted by language.',
			render: setting => { setting.addText(text => text.setValue(String(this.plugin.settings.readLimitWords)).onChange(async value => {
				const limit = Number(value);
				text.inputEl.setCustomValidity(Number.isInteger(limit) && limit > 0 ? '' : 'Enter a positive whole number.');
				if (!text.inputEl.reportValidity()) return;
				this.plugin.settings.readLimitWords = limit;
				await this.plugin.saveData(this.plugin.settings);
			})); },
		}, { name: 'Local storage', desc: 'Proposals stay inside this vault under .proposal. This plugin makes no network requests. CLI callers can read note text and comments.' }];
	}
}
