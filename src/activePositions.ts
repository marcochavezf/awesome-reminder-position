import * as vscode from 'vscode';
import * as json from 'jsonc-parser';
import * as path from 'path';
import * as _ from 'lodash';

export class ActivePositionsProvider implements vscode.TreeDataProvider<number> {

	private _onDidChangeTreeData: vscode.EventEmitter<number | null> = new vscode.EventEmitter<number | null>();
	readonly onDidChangeTreeData: vscode.Event<number | null> = this._onDidChangeTreeData.event;

	private tree: json.Node;
	private text: string;
	private editor: vscode.TextEditor;
	private autoRefresh: boolean = true;
	private positions: {
		[key: string]: any
	};

	constructor(private context: vscode.ExtensionContext) {
		vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged());
		vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));
		this.parseTree();
		this.autoRefresh = vscode.workspace.getConfiguration('activePositions').get('autorefresh');
		vscode.workspace.onDidChangeConfiguration(() => {
			this.autoRefresh = vscode.workspace.getConfiguration('activePositions').get('autorefresh');
		});
		this.onActiveEditorChanged();
		
		this.positions = {};
		setInterval(() => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}
			const activeSelection = activeEditor.selection.active;

			// create or get lastDocument
			const document: vscode.TextDocument = activeEditor.document;
			let lastMetaDoc = this.positions[document.fileName];
			if (!lastMetaDoc) {
				lastMetaDoc = this.positions[document.fileName] = {
					lineCount: document.lineCount,
					lineData: {},
					textLines: document.getText().split('\n'),
				};
			}

			// update all the positions if the lineCount has changed
			if (lastMetaDoc.lineCount !== document.lineCount) {
				const currentTextLines = document.getText().split('\n'); 
				const prevLineData = lastMetaDoc.lineData;
				const prevTextLines = lastMetaDoc.textLines;
				let delta = document.lineCount - lastMetaDoc.lineCount;
				lastMetaDoc.lineData = {};
				let applyDelta = false;
				_.each(prevLineData, ({ weight, text }, line) => {
					const lineNumber = parseInt(line);
					if (!applyDelta && this.isSameLine(prevTextLines, currentTextLines, lineNumber)) {
						lastMetaDoc.lineData[lineNumber] = { weight, text };
					} else if (this.isSameLine(prevTextLines, currentTextLines, lineNumber + delta)) {
						applyDelta = true;
						lastMetaDoc.lineData[lineNumber + delta] = { weight, text };
					}
					if (!lastMetaDoc.lineData[lineNumber]) {
						const newLineNumber = this.getCurrentLine(text, currentTextLines, lineNumber + delta);
						if (newLineNumber) {
							lastMetaDoc.lineData[newLineNumber] = { weight, text };
						} else {
							// debugger;
							// console.error('not able to get current line!');
						}
					}
					console.log(`delta applied: ${ applyDelta }, delta: ${ delta }`)
				}); 
				lastMetaDoc.lineCount = document.lineCount;
				lastMetaDoc.textLines = currentTextLines;
			}

			// update the number of times the positions was active per second
			const line = activeSelection.line;
			lastMetaDoc.lineData[line] = lastMetaDoc.lineData[line] || { weight: 0 };
			lastMetaDoc.lineData[line].weight++;
			lastMetaDoc.lineData[line].text = document.lineAt(line).text;
			console.log(`currentLine: ${ line }, weight: ${ lastMetaDoc.lineData[line].weight }, text: ${ document.lineAt(line).text }`);
		}, 1000);
	}

	compareText(textA, textB){
		return textA.replace(/(\r\n|\n|\r)/gm, '') === textB.replace(/(\r\n|\n|\r)/gm, '');
	}

	getCurrentLine(currentText, currentTextLines, guessLineNumber) {
		const upperLineNumber = guessLineNumber === 1 ? 1 : guessLineNumber - 1;
		if (this.compareText(currentTextLines[upperLineNumber - 1], currentText)) {
			return upperLineNumber - 1;
		}
		const lowerLineNumber = guessLineNumber >= currentTextLines.length ? 1 : guessLineNumber + 1;
		if (this.compareText(currentTextLines[lowerLineNumber - 1], currentText)) {
			return lowerLineNumber - 1;
		}
	}

	isSameLine(prevTextLines, currentTextLines, lineNumber, ignoreNeighbours = false) {
		if (lineNumber > prevTextLines.length || lineNumber > currentTextLines.length) {
			return false;
		}
		
		const isSameLine = this.compareText(prevTextLines[lineNumber - 1], currentTextLines[lineNumber - 1]);
		if (ignoreNeighbours) {
			return isSameLine;
		}

		const lineUpper = lineNumber === 1 ? 1 : lineNumber - 1;
		const lineLower = lineNumber + 1;

		const isSameUpperLine = this.isSameLine(prevTextLines, currentTextLines, lineUpper, true);
		const isSameLowerLine = this.isSameLine(prevTextLines, currentTextLines, lineLower, true);
		return isSameUpperLine && isSameLowerLine && isSameLine;
	}

	refresh(offset?: number): void {
		this.parseTree();
		if (offset) {
			this._onDidChangeTreeData.fire(offset);
		} else {
			this._onDidChangeTreeData.fire();
		}
	}

	rename(offset: number): void {
		vscode.window.showInputBox({ placeHolder: 'Enter the new label' })
			.then(value => {
				if (value !== null && value !== undefined) {
					this.editor.edit(editBuilder => {
						const path = json.getLocation(this.text, offset).path;
						let propertyNode = json.findNodeAtLocation(this.tree, path);
						if (propertyNode.parent.type !== 'array') {
							propertyNode = propertyNode.parent.children[0];
						}
						const range = new vscode.Range(this.editor.document.positionAt(propertyNode.offset), this.editor.document.positionAt(propertyNode.offset + propertyNode.length));
						editBuilder.replace(range, `"${value}"`);
						setTimeout(() => {
							this.parseTree();
							this.refresh(offset);
						}, 100);
					});
				}
			});
	}

	private onActiveEditorChanged(): void {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'file') {
				const enabled = vscode.window.activeTextEditor.document.languageId === 'json' || vscode.window.activeTextEditor.document.languageId === 'jsonc';
				vscode.commands.executeCommand('setContext', 'activePositionsEnabled', enabled);
				if (enabled) {
					this.refresh();
				}
			}
		} else {
			vscode.commands.executeCommand('setContext', 'activePositionsEnabled', false);
		}
	}

	private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
		if (this.autoRefresh && changeEvent.document.uri.toString() === this.editor.document.uri.toString()) {
			for (const change of changeEvent.contentChanges) {
				const path = json.getLocation(this.text, this.editor.document.offsetAt(change.range.start)).path;
				path.pop();
				const node = path.length ? json.findNodeAtLocation(this.tree, path) : void 0;
				this.parseTree();
				this._onDidChangeTreeData.fire(node ? node.offset : void 0);
			}
		}
	}

	private parseTree(): void {
		this.text = '';
		this.tree = null;
		this.editor = vscode.window.activeTextEditor;
		if (this.editor && this.editor.document) {
			this.text = this.editor.document.getText();
			this.tree = json.parseTree(this.text);
		}
	}

	getChildren(offset?: number): Thenable<number[]> {
		if (offset) {
			const path = json.getLocation(this.text, offset).path;
			const node = json.findNodeAtLocation(this.tree, path);
			return Promise.resolve(this.getChildrenOffsets(node));
		} else {
			return Promise.resolve(this.tree ? this.getChildrenOffsets(this.tree) : []);
		}
	}

	private getChildrenOffsets(node: json.Node): number[] {
		const offsets: number[] = [];
		for (const child of node.children) {
			const childPath = json.getLocation(this.text, child.offset).path;
			const childNode = json.findNodeAtLocation(this.tree, childPath);
			if (childNode) {
				offsets.push(childNode.offset);
			}
		}
		return offsets;
	}

	getTreeItem(offset: number): vscode.TreeItem {
		const path = json.getLocation(this.text, offset).path;
		const valueNode = json.findNodeAtLocation(this.tree, path);
		if (valueNode) {
			let hasChildren = valueNode.type === 'object' || valueNode.type === 'array';
			let treeItem: vscode.TreeItem = new vscode.TreeItem(this.getLabel(valueNode), hasChildren ? valueNode.type === 'object' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
			treeItem.command = {
				command: 'extension.openJsonSelection',
				title: '',
				arguments: [new vscode.Range(this.editor.document.positionAt(valueNode.offset), this.editor.document.positionAt(valueNode.offset + valueNode.length))]
			};
			treeItem.iconPath = this.getIcon(valueNode);
			treeItem.contextValue = valueNode.type;
			return treeItem;
		}
		return null;
	}

	select(range: vscode.Range) {
		this.editor.selection = new vscode.Selection(range.start, range.end);
	}

	private getIcon(node: json.Node): any {
		let nodeType = node.type;
		if (nodeType === 'boolean') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'boolean.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'boolean.svg'))
			};
		}
		if (nodeType === 'string') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'string.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'string.svg'))
			};
		}
		if (nodeType === 'number') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'number.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'number.svg'))
			};
		}
		return null;
	}

	private getLabel(node: json.Node): string {
		if (node.parent.type === 'array') {
			let prefix = node.parent.children.indexOf(node).toString();
			if (node.type === 'object') {
				return prefix + ':{ }';
			}
			if (node.type === 'array') {
				return prefix + ':[ ]';
			}
			return prefix + ':' + node.value.toString();
		}
		else {
			const property = node.parent.children[0].value.toString();
			if (node.type === 'array' || node.type === 'object') {
				if (node.type === 'object') {
					return '{ } ' + property;
				}
				if (node.type === 'array') {
					return '[ ] ' + property;
				}
			}
			const value = this.editor.document.getText(new vscode.Range(this.editor.document.positionAt(node.offset), this.editor.document.positionAt(node.offset + node.length)));
			return `${property}: ${value}`;
		}
	}
}