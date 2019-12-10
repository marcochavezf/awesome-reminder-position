export interface Positions {
    [fileName:string]: MetaDoc;
}

export interface MetaDoc {
    lineCount: number;
    linesData: {
        [lineNumber:string]: LineData
    };
    textLines: string[];
}

export interface LineData {
    weight: number;
    text: string;
}