import { App, Modal, Setting } from 'obsidian';

export function confirmAction(app: App, title: string, description: string): Promise<boolean> {
	return new Promise(resolve => {
		class ConfirmModal extends Modal {
			private confirmed = false;
			onOpen() {
				this.setTitle(title);
				this.contentEl.createEl('p', { text: description });
				new Setting(this.contentEl)
					.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
					.addButton(button => button.setButtonText('Confirm').setDestructive().onClick(() => {
						this.confirmed = true;
						this.close();
					}));
			}
			onClose() { resolve(this.confirmed); }
		}
		new ConfirmModal(app).open();
	});
}
