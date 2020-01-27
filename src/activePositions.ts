import { Positions, MetaDoc, LineData, PositionData } from './types';
import * as vscode from 'vscode';
import * as path from 'path';
import * as _ from 'lodash';
import * as timeago from 'timeago.js';
export class ActivePositionsProvider implements vscode.TreeDataProvider<PositionData> {

	private _onDidChangeTreeData: vscode.EventEmitter<PositionData | null> = new vscode.EventEmitter<PositionData | null>();
	readonly onDidChangeTreeData: vscode.Event<PositionData | null> = this._onDidChangeTreeData.event;

	private editor: vscode.TextEditor;
	private autoRefresh: boolean = true;
	private positions: Positions;
	private maxWeight: number;

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
				_.each(prevLinesData, (lineData: LineData, line) => {
					const lineNumber = parseInt(line);
					if (!applyDelta && this.isSameLine(prevTextLines, currentTextLines, lineNumber)) {
						lastMetaDoc.linesData[lineNumber] = lineData;
					} else if (this.isSameLine(prevTextLines, currentTextLines, lineNumber + delta)) {
						applyDelta = true;
						lastMetaDoc.linesData[lineNumber + delta] = lineData;
					}
					if (!lastMetaDoc.linesData[lineNumber]) {
						const newLineNumber = this.getCurrentLine(lineData.text, currentTextLines, lineNumber + delta);
						if (newLineNumber) {
							lastMetaDoc.linesData[newLineNumber] = lineData;
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
			const currentLine = active.line;
			const updatedLineData: LineData = lastMetaDoc.linesData[currentLine] || { weight: 0, text: '' };
			updatedLineData.weight++;
			updatedLineData.text = document.lineAt(currentLine).text;
			delete lastMetaDoc.linesData[currentLine];
			lastMetaDoc.linesData[currentLine] = updatedLineData;
			// console.log(`currentLine: ${ line }, weight: ${lineData.weight }, text: ${ document.lineAt(line).text }`);
			
			// set lastTimeActive acording to TIME_UPDATE_TIMESTAMP
			if (lastActivePos.fileName === document.fileName && parseInt(lastActivePos.lineNumber) === currentLine) {
				timesLasPosActive++;
			} else {
				timesLasPosActive = 0;
				lastActivePos.fileName = document.fileName;
				lastActivePos.lineNumber = `${currentLine}`;
			}
			if (timesLasPosActive >= ITERATIONS_TO_UPDATE_TIMESTAMP) {
				timesLasPosActive = 0;
				updatedLineData.lastTimeActive = Date.now();
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

	deleteAll(): void {
		this.positions = {};
		this._onDidChangeTreeData.fire();
	}

	deleteItem(posData: PositionData): void {
		const { fileName, lineNumbers } = posData;
		const { linesData } = this.positions[fileName];
		lineNumbers.forEach(lineNumber => {
			delete linesData[lineNumber];
		});
		this._onDidChangeTreeData.fire();
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
		let maxWeight = 0;
		const limitTimeExpiration = 1000 * 60 * 60 * 4; // 4 hours
		const fileNames = Object.keys(this.positions);
		const allPositions = fileNames.reduce((totalPos, fileName) => {
			const OFFSET_MULTI_LINE_SELECTION = 5;
			let pivotOffset = -1;

			const metaDoc: MetaDoc = this.positions[fileName];
			const { linesData } = metaDoc;
			const lineNumbers = Object.keys(linesData);
			const posData: PositionData[] = lineNumbers
				.filter(lineNumber => { 
					const { lastTimeActive } = linesData[lineNumber];
					if (lastTimeActive) {
						const hasExpired = (Date.now() - lastTimeActive) > limitTimeExpiration;
						if (hasExpired) {
							delete linesData[lineNumber]; // remove expired positions
							return false;
						} else {
							return true;
						}
					}
					return false;
				}) // filter out expired lines
				.sort((a, b) => parseInt(a) - parseInt(b)) // sort by line number
				.reduce((positionsData, lineNumber) => {
					const lineNumberInt = parseInt(lineNumber);
					if (lineNumberInt < pivotOffset) {
						return positionsData;
					}
					pivotOffset = lineNumberInt + OFFSET_MULTI_LINE_SELECTION;
					let accumulatedWeight = this.getLineData({ fileName, lineNumber }).weight;
					let endMultiLine = -1;
					let lastActiveTime = this.getLastTimeActive({ fileName, lineNumber });
					let mostActiveLineNumber = lineNumber;
					for (let i = lineNumberInt + 1; i < pivotOffset; i++) {
						endMultiLine = linesData[i] ? i : endMultiLine;
						const endLineNumber = `${ i }`;
						const endMultiTimeActive = linesData[i] ? this.getLastTimeActive({ fileName, lineNumber: endLineNumber }) : 0;
						if (endMultiTimeActive) {
							accumulatedWeight += this.getLineData({ fileName, lineNumber }).weight;
							if (endMultiTimeActive > lastActiveTime) {
								lastActiveTime = endMultiTimeActive;
								mostActiveLineNumber = endLineNumber;
							}
						}
					}
					const newPosData: PositionData = { fileName, lineNumber: mostActiveLineNumber, lineNumbers: [lineNumber], accumulatedWeight };
					if (endMultiLine >= 0) {
						newPosData.lineNumbers.push(`${ endMultiLine }`);
					}
					if (maxWeight < accumulatedWeight) {
						maxWeight = accumulatedWeight;
					}
					return [...positionsData, newPosData];
				}, []); // create a multi line group
			
			return [...totalPos, ...posData];
		}, []).sort((posDataA: PositionData, posDataB: PositionData) => {
			return this.getLastTimeActive(posDataB) - this.getLastTimeActive(posDataA);
		});
		this.maxWeight = maxWeight;
		return Promise.resolve(allPositions);
	}

	getLineData(posData: PositionData): LineData {
		const { fileName, lineNumber } = posData;
		return this.positions[fileName].linesData[lineNumber];
	}

	getLastTimeActive(posData: PositionData) {
		return this.getLineData(posData).lastTimeActive;
	}

	getTreeItem(posData: PositionData): vscode.TreeItem {
		const { fileName, lineNumber, lineNumbers, accumulatedWeight } = posData;
		const hasChildren = !lineNumber;

		let filePaths = fileName.split('\\');
		if (fileName.startsWith('/')) {
			filePaths = fileName.split('/');
		}
		const fileNameShort = filePaths[filePaths.length - 1];
		const { linesData, textLines } = this.positions[fileName];
		const { text, weight, lastTimeActive } = linesData[lineNumber];
		const labelLine = hasChildren ? '' : lineNumbers.map(lineNum => parseInt(lineNum) + 1).join('-');
		// const label = `${ fileNameShort }:${ labelLine } -> ${ text.trim() } (${ weight })`;
		const label = `${ fileNameShort }:${ labelLine }`;
		const treeItem: vscode.TreeItem = new vscode.TreeItem(label, hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
		treeItem.command = {
			command: 'extension.setPosition',
			title: '',
			// arguments: [new vscode.Range(this.editor.document.positionAt(valueNode.offset), this.editor.document.positionAt(valueNode.offset + valueNode.length))]
			arguments: [posData]
		};
		treeItem.description = `(${ timeago.format(lastTimeActive) })`;
		if (!hasChildren) {
			if (lineNumbers.length === 1) {
				treeItem.tooltip = text.trim();
			} else {
				const lastPos = parseInt(_.last(lineNumbers));
				const firstPos = parseInt(_.first(lineNumbers));
				treeItem.tooltip =`...\n${ Array
					.from({length: lastPos - firstPos + 1 }, (el, index) => firstPos + index)
					.map(pos => textLines[pos])
					.join('\n')}\n...`;
			}
		}
		// we want to get values from 1 to 10
		const indicator = Math.min(Math.floor(accumulatedWeight/this.maxWeight * 10) + 1, 10);
		treeItem.iconPath = this.getIcon(indicator);
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
		vscode.window.showTextDocument(textDocument).then(editor => {
			const posLineNumber = parseInt(lineNumber);
			const newPosition = editor.selection.active.with(posLineNumber);
			const newSelection = new vscode.Selection(newPosition, newPosition);
			editor.selection = newSelection;

			// scroll to the given range
			const upperLineNumber = posLineNumber - 10;
			const upperPos = newPosition.with(upperLineNumber >= 0 ? upperLineNumber : 0);
			editor.revealRange(new vscode.Range(upperPos, newPosition));
		});
	}

	private getIcon(indicator: number): any {
		return {
			light: this.context.asAbsolutePath(path.join('resources', 'light', 'indicator', `square-${ indicator }.svg`)),
			dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'indicator', `square-${ indicator }.svg`))
		};
	}
}