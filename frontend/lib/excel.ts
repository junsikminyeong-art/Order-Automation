import * as XLSX from "xlsx";
import { ExcelInfo } from "../types";

export async function readExcel(file: File): Promise<ExcelInfo> {

  const data = await file.arrayBuffer();

  const workbook = XLSX.read(data);

  const sheetName = workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet);

  return {

    fileName: file.name,

    sheetName,

    rowCount: rows.length,

    rows,

  };

}