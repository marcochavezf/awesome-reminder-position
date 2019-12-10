export interface Positions {
    [fileName:string]: MetaDoc;
}

export interface MetaDoc {
    lineCount: number;
    lineData: LineData;
    textLines: string[];
}

export interface LineData {
    weight: number;
    text: string;
}