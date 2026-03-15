import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from "@aws-sdk/client-athena";

const client = new AthenaClient({
  region: process.env.AWS_REGION || "ap-northeast-1",
});

export const runAthenaQuery = async (query: string) => {
  const startCommand = new StartQueryExecutionCommand({
    QueryString: query,
    QueryExecutionContext: { Database: process.env.ATHENA_DATABASE },
    ResultConfiguration: { OutputLocation: process.env.ATHENA_OUTPUT_S3_PATH },
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

const parseAthenaResults = (results: any) => {
  const columns = results.ResultSet.ResultSetMetadata.ColumnInfo.map((col: any) => col.Name);
  return results.ResultSet.Rows.slice(1).map((row: any) => {
    const data: Record<string, any> = {};
    row.Data.forEach((val: any, i: number) => {
      data[columns[i]] = val.VarCharValue;
    });
    return data;
  });
};
