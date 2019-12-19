// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ActivePositionsProvider } from './activePositions';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const activePosProvider = new ActivePositionsProvider(context);
	vscode.window.registerTreeDataProvider('activePositions', activePosProvider);
	vscode.commands.registerCommand('activePositions.reset', () => activePosProvider.reset());
	// vscode.commands.registerCommand('activePositions.refreshNode', offset => activePosProvider.refresh(offset));
	// vscode.commands.registerCommand('activePositions.renameNode', offset => activePosProvider.rename(offset));
	// vscode.commands.registerCommand('extension.openJsonSelection', range => activePosProvider.select(range));
	vscode.commands.registerCommand('extension.setPosition', posData => activePosProvider.select(posData));
}

// this method is called when your extension is deactivated
export function deactivate() {}
