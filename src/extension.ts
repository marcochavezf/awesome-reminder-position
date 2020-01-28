// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ActivePositionsProvider } from './activePositions';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const activePosProvider = new ActivePositionsProvider(context);
	vscode.window.registerTreeDataProvider('activePositions', activePosProvider);
	vscode.commands.registerCommand('activePositions.deleteAll', () => activePosProvider.deleteAll());
	vscode.commands.registerCommand('activePositions.deleteItem', posData => activePosProvider.deleteItem(posData));
	vscode.commands.registerCommand('activePositions.updateList', () => activePosProvider.updateList());
	vscode.commands.registerCommand('activePositions.sortByLastActive', () => activePosProvider.sortByLastActive());
	vscode.commands.registerCommand('activePositions.sortByFile', () => activePosProvider.sortByFile());
	vscode.commands.registerCommand('extension.setPosition', posData => activePosProvider.select(posData));
}

// this method is called when your extension is deactivated
export function deactivate() {}
