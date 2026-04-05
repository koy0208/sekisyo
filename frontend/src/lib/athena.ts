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

  const resultsCommand = new GetQueryResultsCommand({ QueryExecutionId });
  const results = await client.send(resultsCommand);
  return parseAthenaResults(results);
};

const parseAthenaResults = (results: GetQueryResultsCommandOutput): AthenaRow[] => {
  const columnInfo = results.ResultSet?.ResultSetMetadata?.ColumnInfo;
  const rows = results.ResultSet?.Rows;

  if (!columnInfo || !rows) return [];

  const columns = columnInfo.map((col) => col.Name || "");
  
  // The first row is the header, so we skip it
  return rows.slice(1).map((row) => {
    const data: AthenaRow = {};
    row.Data?.forEach((val, i) => {
      const columnName = columns[i];
      if (columnName) {
        data[columnName] = val.VarCharValue;
      }
    });
    return data;
  });
};
