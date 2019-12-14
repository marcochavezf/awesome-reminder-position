import { Position, TextDocument } from 'vscode';

export interface Positions {
    [fileName:string]: MetaDoc;
}

export interface MetaDoc {
    lineCount: number;
    linesData: {
        [lineNumber:string]: LineData
    };
    textLines: string[];
    textDocument: TextDocument;
}

export interface LineData {
    weight: number;
    text: string;
    lastTimeActive?: number;
}

export interface PositionData {
    fileName: string;
    lineNumber?: string;
}