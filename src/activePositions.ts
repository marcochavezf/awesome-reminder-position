import { Positions, MetaDoc, LineData, PositionData } from './types';
import * as vscode from 'vscode';
import * as path from 'path';
import * as _ from 'lodash';
export class ActivePositionsProvider implements vscode.TreeDataProvider<PositionData> {

	private _onDidChangeTreeData: vscode.EventEmitter<PositionData | null> = new vscode.EventEmitter<PositionData | null>();
	readonly onDidChangeTreeData: vscode.Event<PositionData | null> = this._onDidChangeTreeData.event;

	private editor: vscode.TextEditor;
	private autoRefresh: boolean = true;
	private positions: Positions;

	constructor(private context: vscode.ExtensionContext) {
		vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged());
		vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));

		this.autoRefresh = vscode.workspace.getConfiguration('activePositions').get('autorefresh');
		vscode.workspace.onDidChangeConfiguration(() => {
			this.autoRefresh = vscode.workspace.getConfiguration('activePositions').get('autorefresh');
		});
		this.onActiveEditorChanged();
		
		this.positions = {};
		const TIME_INTERVAL = 1000; // 1 second
		const TIME_UPDATE_TIMESTAMP = 5000; // every 5 seconds
		const ITERATIONS_TO_UPDATE_TIMESTAMP = TIME_UPDATE_TIMESTAMP / TIME_INTERVAL;

		let timesLasPosActive = 0;
		let lastActivePos: PositionData = { fileName: '', lineNumber: '' };
		setInterval(() => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}
			let updateTreeView = false;
			const { active } = activeEditor.selection;

			// create or get lastDocument
			const document: vscode.TextDocument = activeEditor.document;
			let lastMetaDoc: MetaDoc = this.positions[document.fileName];
			if (!lastMetaDoc) {
				lastMetaDoc = this.positions[document.fileName] = {
					lineCount: document.lineCount,
					linesData: {},
					textLines: document.getText().split('\n'),
					textDocument: document,
				};
			}

			// update all the positions if the lineCount has changed
			if (lastMetaDoc.lineCount !== document.lineCount) {
				const currentTextLines = document.getText().split('\n'); 
				const prevLinesData = lastMetaDoc.linesData;
				const prevTextLines = lastMetaDoc.textLines;
				let delta = document.lineCount - lastMetaDoc.lineCount;
				lastMetaDoc.linesData = {};
				let applyDelta = false;
				_.each(prevLinesData, ({ weight, text }, line) => {
					const lineNumber = parseInt(line);
					if (!applyDelta && this.isSameLine(prevTextLines, currentTextLines, lineNumber)) {
						lastMetaDoc.linesData[lineNumber] = { weight, text };
					} else if (this.isSameLine(prevTextLines, currentTextLines, lineNumber + delta)) {
						applyDelta = true;
						lastMetaDoc.linesData[lineNumber + delta] = { weight, text };
					}
					if (!lastMetaDoc.linesData[lineNumber]) {
						const newLineNumber = this.getCurrentLine(text, currentTextLines, lineNumber + delta);
						if (newLineNumber) {
							lastMetaDoc.linesData[newLineNumber] = { weight, text };
						} else {
							// debugger;
							// console.error('not able to get current line!');
						}
					}
					// console.log(`delta applied: ${ applyDelta }, delta: ${ delta }`);
				}); 
				lastMetaDoc.lineCount = document.lineCount;
				lastMetaDoc.textLines = currentTextLines;
				updateTreeView = true;
			}

			// update the number of times the positions was active per second
			const line = active.line;
			const lineData: LineData = lastMetaDoc.linesData[line] || { weight: 0, text: '' };
			lineData.weight++;
			lineData.text = document.lineAt(line).text;
			delete lastMetaDoc.linesData[line];
			lastMetaDoc.linesData[line] = lineData;
			// console.log(`currentLine: ${ line }, weight: ${lineData.weight }, text: ${ document.lineAt(line).text }`);
			
			// set lastTimeActive acording to TIME_UPDATE_TIMESTAMP
			if (lastActivePos.fileName === document.fileName || parseInt(lastActivePos.lineNumber) === line) {
				timesLasPosActive++;
			} else {
				timesLasPosActive = 0;
				lastActivePos.fileName = document.fileName;
				lastActivePos.lineNumber = `${line}`;
			}
			if (timesLasPosActive >= ITERATIONS_TO_UPDATE_TIMESTAMP) {
				timesLasPosActive = 0;
				lineData.lastTimeActive = Date.now();
				updateTreeView = true;
			}

			if (updateTreeView) {
				this._onDidChangeTreeData.fire();
			}
		}, TIME_INTERVAL);
	}

	private compareText(textA, textB){
		return textA.replace(/(\r\n|\n|\r)/gm, '') === textB.replace(/(\r\n|\n|\r)/gm, '');
	}

	private getCurrentLine(currentText, currentTextLines, guessLineNumber) {
		const upperLineNumber = guessLineNumber === 1 ? 1 : guessLineNumber - 1;
		if (this.compareText(currentTextLines[upperLineNumber - 1], currentText)) {
			return upperLineNumber - 1;
		}
		const lowerLineNumber = guessLineNumber >= currentTextLines.length ? 1 : guessLineNumber + 1;
		if (this.compareText(currentTextLines[lowerLineNumber - 1], currentText)) {
			return lowerLineNumber - 1;
		}
	}

	private isSameLine(prevTextLines, currentTextLines, lineNumber, ignoreNeighbours = false) {
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

	refresh(offset?: PositionData): void {
		if (offset) {
			this._onDidChangeTreeData.fire(offset);
		} else {
			this._onDidChangeTreeData.fire();
		}
	}

	private onActiveEditorChanged(): void {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'file') {
				// const enabled = vscode.window.activeTextEditor.document.languageId === 'json' || vscode.window.activeTextEditor.document.languageId === 'jsonc';
				// vscode.commands.executeCommand('setContext', 'activePositionsEnabled', enabled);
				// if (enabled) {
				// 	this.refresh();
				// }
				this.refresh();
				vscode.commands.executeCommand('setContext', 'activePositionsEnabled', true);
			}
		} else {
			vscode.commands.executeCommand('setContext', 'activePositionsEnabled', false);
		}
	}

	private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
		// debugger;
		if (this.autoRefresh && changeEvent.document.uri.toString() === this.editor.document.uri.toString()) {
			for (const change of changeEvent.contentChanges) {
				// const path = json.getLocation(this.text, this.editor.document.offsetAt(change.range.start)).path;
				// path.pop();
				// const node = path.length ? json.findNodeAtLocation(this.tree, path) : void 0;
				// this.parseTree();
				// this._onDidChangeTreeData.fire(node ? node.offset : void 0);
			}
		}
	}

	getChildren(): Thenable<PositionData[]> {
		// if (offset) {
		// 	const { fileName } = offset;
		// 	const metaDoc: MetaDoc = this.positions[fileName];
		// 	const { linesData } = metaDoc;
		// 	const lineNumbers = Object.keys(linesData);
		// 	const fileOffsets: PositionData[] = lineNumbers
		// 		.filter(lineNumber => !!linesData[lineNumber].lastTimeActive)
		// 		.sort((lineA, lineB) => linesData[lineB].lastTimeActive - linesData[lineA].lastTimeActive)
		// 		.map(lineNumber => ({ fileName, lineNumber }));
		// 	return Promise.resolve(fileOffsets);
		// } else {
		// 	const fileOffsets: PositionData[] = Object.keys(this.positions).map(fileName => ({ fileName })); 
		// 	return Promise.resolve(fileOffsets);
		// }
		const fileNames = Object.keys(this.positions);
		const allPositions = fileNames.reduce((totalPos, fileName) => {
			const metaDoc: MetaDoc = this.positions[fileName];
			const { linesData } = metaDoc;
			const lineNumbers = Object.keys(linesData);
			const posData: PositionData[] = lineNumbers
				.filter(lineNumber => !!linesData[lineNumber].lastTimeActive)
				.map(lineNumber => ({ fileName, lineNumber }));
			return [...totalPos, ...posData];
		}, []).sort((posDataA: PositionData, posDataB: PositionData) => {
			return this.getLastTimeActive(posDataB) - this.getLastTimeActive(posDataA);
		});		
		return Promise.resolve(allPositions);
	}

	getLastTimeActive(posData: PositionData) {
		const { fileName, lineNumber } = posData;
		return this.positions[fileName].linesData[lineNumber].lastTimeActive;
	}

	getTreeItem(posData: PositionData): vscode.TreeItem {
		const { fileName, lineNumber } = posData;
		const hasChildren = !lineNumber;

		const filePaths = fileName.split('\\');
		const fileNameShort = filePaths[filePaths.length - 1];
		const { text, weight } = this.positions[fileName].linesData[lineNumber];
		const label = `${ fileNameShort }:${ lineNumber } -> ${ text.trim() } (${ weight })`;
		const treeItem: vscode.TreeItem = new vscode.TreeItem(label, hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
		treeItem.command = {
			command: 'extension.setPosition',
			title: '',
			// arguments: [new vscode.Range(this.editor.document.positionAt(valueNode.offset), this.editor.document.positionAt(valueNode.offset + valueNode.length))]
			arguments: [posData]
		};
		// treeItem.iconPath = this.getIcon(hasChildren);
		// treeItem.contextValue = valueNode.type;
		return treeItem;
	}

	select(posData: PositionData) {
		const { fileName, lineNumber } = posData;
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			return;
		}
		
		const { textDocument } = this.positions[fileName]; 
		vscode.window.showTextDocument(textDocument).then(e => {
			const posLineNumber = parseInt(lineNumber);
			const newPosition = activeEditor.selection.active.with(posLineNumber, 0);
			const newSelection = new vscode.Selection(newPosition, newPosition);
			activeEditor.selection = newSelection;
			activeEditor.revealRange(new vscode.Range(newPosition, newPosition));
		});
	}

	private getIcon(hasChildren: boolean): any {
		if (hasChildren) {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'dependency.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'dependency.svg'))
			};
		} else {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'boolean.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'boolean.svg'))
			};
		}
	}

// 	private getLabel(node: json.Node): string {
// 		if (node.parent.type === 'array') {
// 			let prefix = node.parent.children.indexOf(node).toString();
// 			if (node.type === 'object') {
// 				return prefix + ':{ }';
// 			}
// 			if (node.type === 'array') {
// 				return prefix + ':[ ]';
// 			}
// 			return prefix + ':' + node.value.toString();
// 		}
// 		else {
// 			const property = node.parent.children[0].value.toString();
// 			if (node.type === 'array' || node.type === 'object') {
// 				if (node.type === 'object') {
// 					return '{ } ' + property;
// 				}
// 				if (node.type === 'array') {
// 					return '[ ] ' + property;
// 				}
// 			}
// 			const value = this.editor.document.getText(new vscode.Range(this.editor.document.positionAt(node.offset), this.editor.document.positionAt(node.offset + node.length)));
// 			return `${property}: ${value}`;
// 		}
// 	}

}