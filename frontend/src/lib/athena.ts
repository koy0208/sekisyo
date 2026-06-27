import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand, GetQueryResultsCommandOutput } from "@aws-sdk/client-athena";

export type AthenaRow = Record<string, string | undefined>;

export const runAthenaQuery = async (query: string, database?: string): Promise<AthenaRow[]> => {
  const client = new AthenaClient({
    region: process.env.AWS_REGION || "ap-northeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });

  const startCommand = new StartQueryExecutionCommand({
    QueryString: query,
    QueryExecutionContext: { Database: database ?? process.env.ATHENA_DATABASE },
    ResultConfiguration: { OutputLocation: process.env.ATHENA_OUTPUT_S3_PATH },
    WorkGroup: process.env.ATHENA_WORKGROUP || "sekisyo-workgroup",
  });

  const { QueryExecutionId } = await client.send(startCommand);

  if (!QueryExecutionId) throw new Error("Failed to start Athena query");

  // Polling for results
  let status = "RUNNING";
  while (status === "RUNNING" || status === "QUEUED") {
    const statusCommand = new GetQueryExecutionCommand({ QueryExecutionId });
    const { QueryExecution } = await client.send(statusCommand);
    status = QueryExecution?.Status?.State || "FAILED";
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Athena query failed: ${QueryExecution?.Status?.StateChangeReason}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // GetQueryResults は 1 ページ最大 1000 行。NextToken で全ページ取得する
  // (ページング未対応だと先頭 1000 行で打ち切られる)。
  const allRows: AthenaRow[] = [];
  let columns: string[] = [];
  let nextToken: string | undefined = undefined;
  let isFirstPage = true;

  do {
    const resultsCommand = new GetQueryResultsCommand({ QueryExecutionId, NextToken: nextToken });
    const results: GetQueryResultsCommandOutput = await client.send(resultsCommand);

    const columnInfo = results.ResultSet?.ResultSetMetadata?.ColumnInfo;
    if (columns.length === 0 && columnInfo) {
      columns = columnInfo.map((col) => col.Name || "");
    }

    const rows = results.ResultSet?.Rows ?? [];
    // ヘッダ行は最初のページの先頭のみに含まれる
    const dataRows = isFirstPage ? rows.slice(1) : rows;
    for (const row of dataRows) {
      const data: AthenaRow = {};
      row.Data?.forEach((val, i) => {
        const columnName = columns[i];
        if (columnName) data[columnName] = val.VarCharValue;
      });
      allRows.push(data);
    }

    nextToken = results.NextToken;
    isFirstPage = false;
  } while (nextToken);

  return allRows;
};
