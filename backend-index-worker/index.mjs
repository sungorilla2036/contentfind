import archiver from "archiver";
import AWS from "aws-sdk";
import { exec } from "child_process";
import "dotenv/config";
import fs from "fs";
import { globSync } from "glob";
import * as pagefind from "pagefind";
import { XMLParser } from "fast-xml-parser";
import unzipper from "unzipper";
import { decode } from "html-entities";
import path from "path";

// Add new environment variables for account ID and database ID
const {
  CF_ZONE_ID,
  CF_ACCOUNT_ID,
  D1_DATABASE_ID,
  D1_API_TOKEN,
  R2_BUCKET_NAME,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_CUSTOM_DOMAIN,
} = process.env;

// Construct the D1 API endpoint URL
const D1_API_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/raw`;

// Configure Cloudflare R2 using the account ID
const s3 = new AWS.S3({
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`, // Constructed using account ID
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
});

async function fetchAndUpdateOldestJobWithStatus(status, newStatus) {
  const transaction = `
    WITH selected_job AS (
      SELECT * FROM indexer_jobs 
      WHERE job_state = ? 
      ORDER BY queued ASC 
      LIMIT 1
    )
    UPDATE indexer_jobs
    SET job_state = ?
    WHERE (platform_id, channel_id) IN (SELECT platform_id, channel_id FROM selected_job)
    RETURNING *;
  `;

  const response = await fetch(D1_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      params: [status, newStatus],
      sql: transaction,
    }),
  });

  const data = await response.json();

  console.log(JSON.stringify(data));

  // Check if response has expected structure
  if (!data.result?.[0]?.results?.columns || !data.result?.[0]?.results?.rows) {
    return null;
  }

  const { columns, rows } = data.result[0].results;

  // Return null if no rows returned
  if (rows.length === 0) {
    return null;
  }

  // Convert first row to object using column names as keys
  const result = columns.reduce((obj, column, index) => {
    obj[column] = rows[0][index];
    return obj;
  }, {});

  return result;
}

async function updateJobStatus(platform_id, channel_id, newStatus) {
  const transaction = `
    UPDATE indexer_jobs
    SET job_state = ?
    WHERE platform_id = ? AND channel_id = ?;
  `;

  const response = await fetch(D1_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      params: [newStatus, platform_id, channel_id],
      sql: transaction,
    }),
  });

  const data = await response.json();

  console.log(JSON.stringify(data));

  // Check if response has expected structure
  if (!data.result?.[0]?.results?.columns || !data.result?.[0]?.results?.rows) {
    return null;
  }

  const { columns, rows } = data.result[0].results;

  // Return null if no rows returned
  if (rows.length === 0) {
    return null;
  }

  // Convert first row to object using column names as keys
  const result = columns.reduce((obj, column, index) => {
    obj[column] = rows[0][index];
    return obj;
  }, {});

  return result;
}

async function processJob(job, download_only) {
  console.log(
    `Starting processing job for platform_id: ${job.platform_id}, channel_id: ${job.channel_id}`
  );
  const { platform_id, channel_id } = job;

  const transcriptsZipKey = `${platform_id}/${channel_id}/transcripts.zip`;
  const channelFolder = `tmp/${platform_id.toString()}/${channel_id}`;
  const transcriptsFolder = `${channelFolder}/transcripts`;
  fs.mkdirSync(channelFolder, { recursive: true });

  // Attempt to download index.json from Cloudflare R2
  let savedVideoData = {};
  console.log("Attempting to download index.json from Cloudflare R2");
  try {
    const params = {
      Bucket: R2_BUCKET_NAME,
      Key: `${platform_id}/${channel_id}/index.json`,
    };
    const data = await s3.getObject(params).promise();
    savedVideoData = indexArrToObj(JSON.parse(data.Body));
    console.log("index.json downloaded successfully");
  } catch (error) {
    if (error.code !== "NoSuchKey") {
      console.error("Error downloading index.json:", error);
    }
    console.log("No existing index.json found, proceeding...");
  }

  // Attempt to download transcripts.zip from Cloudflare R2
  console.log("Attempting to download transcripts.zip from Cloudflare R2");
  try {
    const params = {
      Bucket: R2_BUCKET_NAME,
      Key: transcriptsZipKey,
    };
    const data = await s3.getObject(params).promise();
    const zipPath = `${channelFolder}/transcripts.zip`;
    fs.writeFileSync(zipPath, data.Body);

    // Unzip if present
    const directory = await unzipper.Open.file(zipPath);
    await directory.extract({ path: transcriptsFolder });
    console.log("transcripts.zip downloaded and extracted successfully");
    // Delete the zip file
    fs.unlinkSync(zipPath);
  } catch (error) {
    console.log("No existing transcripts.zip found, proceeding...");
    fs.mkdirSync(transcriptsFolder, { recursive: true });
  }

  // Retrieve video list using yt-dlp
  console.log("Retrieving video list using yt-dlp");
  const playlistUrl = `https://www.youtube.com/@${channel_id}`;
  const ytDlpCommand = `yt-dlp --flat-playlist  --dump-json ${playlistUrl}`; //--extractor-args "youtubetab:approximate_date"
  const videoListRaw = await execCommand(ytDlpCommand);
  const videos = parseVideoList(videoListRaw).filter((video) =>
    video.url.startsWith("https://www.youtube.com/watch?v=")
  ); //TODO handle shorts

  // Download transcripts starting from newest video
  console.log("Downloading transcripts for new videos");
  const transcriptExtension = "srv1";
  for (const video of videos) {
    if (fs.existsSync(`${transcriptsFolder}/${video.id}.json`)) {
      if (savedVideoData[video.id]) {
        video.upload_date = savedVideoData[video.id].date
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        video.language = savedVideoData[video.id].language || "en";
      }
      continue; // Skip if transcript already present
    }

    try {
      const videoJSON = await execCommand(
        `yt-dlp --write-subs --write-auto-subs --dump-json --no-simulate --skip-download --no-warnings --sub-lang ".*orig" --sub-format "${transcriptExtension}" --output "${transcriptsFolder}/%(id)s.%(ext)s" https://www.youtube.com/watch?v=${video.id}`
      );
      // check transcript was downloaded
      const globPattern = `${transcriptsFolder}/${video.id}.*.${transcriptExtension}`;
      console.log(globPattern);
      const transcriptFilesAfter = globSync(globPattern);
      console.log(transcriptFilesAfter);
      if (transcriptFilesAfter.length > 0) {
        video.newTranscript = true;
        video.language = transcriptFilesAfter[0].split(".").slice(-2)[0];
        video.language = video.language.endsWith("-orig")
          ? video.language.slice(0, -5)
          : video.language;
        // rename transcript file
        fs.renameSync(
          transcriptFilesAfter[0],
          `${transcriptsFolder}/${video.id}.${transcriptExtension}`
        );
        console.log(`Downloaded transcripts for video ID: ${video.id}`);
      } else {
        video.missingTranscript = true;
        console.log(`No transcripts found for video ID: ${video.id}`);
      }

      const videoData = JSON.parse(videoJSON);
      video.upload_date = videoData.upload_date;
    } catch (error) {
      console.error(
        `Error downloading transcripts for video ID: ${video.id} - ${error}`
      );
    }
  }

  // If this is a download-only worker
  if (download_only) {
    console.log("Worker is in download-only mode");
    await writeIndexJson(videos, `${channelFolder}/index.json`);
    console.log("index.json written");

    if (videos.find((video) => video.newTranscript === true)) {
      await zipFolder(transcriptsFolder, `${channelFolder}/transcripts.zip`);
      console.log("transcripts.zip created");
    }
    await uploadFiles(videos, platform_id, channel_id, true);
    console.log("Files uploaded to Cloudflare R2");

    await updateJobStatus(platform_id, channel_id, 2); // Update status to waiting for indexing
    console.log("Job status updated to waiting for indexing");
    return;
  }

  // Create a Pagefind search index
  if (videos.find((video) => video.newTranscript === true)) {
    console.log("Creating Pagefind search index");
    const { index } = await pagefind.createIndex();

    // Index all transcripts
    console.log("Indexing all transcripts");
    const xmlParser = new XMLParser({ ignoreAttributes: false });
    for (const video of videos) {
      const videoTranscriptPath = `${transcriptsFolder}/${video.id}.${transcriptExtension}`;
      if (fs.existsSync(videoTranscriptPath)) {
        const content = fs.readFileSync(videoTranscriptPath, "utf-8");
        const parsedTranscript = xmlParser.parse(content);

        // Use createTranscriptArrayFromSrv1 to get both the transcript array and text lines
        const transcriptArray = createTranscriptArrayFromSrv1(parsedTranscript);

        // Extract text lines for indexing
        const textLines = transcriptArray.map((item) => item[2]);

        index.addCustomRecord({
          url: video.id,
          content: textLines.join(" "),
          language: video.language,
          meta: {
            title: video.title,
          },
          sort: {
            date: video.upload_date,
          },
        });

        // Save the JSON file
        fs.writeFileSync(
          `${transcriptsFolder}/${video.id}.json`,
          JSON.stringify(transcriptArray)
        );
        fs.unlinkSync(videoTranscriptPath); // Delete the srv1 file

        console.log(`Indexed transcript for video ID: ${video.id}`);
      }
    }

    // Write the search bundle to disk
    console.log("Writing search bundle to disk");
    const searchBundlePath = `${channelFolder}/pagefind`;
    fs.mkdirSync(searchBundlePath, { recursive: true });
    fs.mkdirSync(`${searchBundlePath}/index`, { recursive: true });
    fs.mkdirSync(`${searchBundlePath}/fragment`, { recursive: true });
    await index.writeFiles({
      outputPath: searchBundlePath,
    });

    if (errors.length > 0) {
      console.error(errors);
      throw new Error("Error creating search bundle");
    }

    console.log("Zipping transcripts folder");
    await zipFolder(transcriptsFolder, `${channelFolder}/transcripts.zip`);
  }

  // Write video list and current date to index.json
  console.log("Writing index.json");
  await writeIndexJson(videos, `${channelFolder}/index.json`);

  // Upload files to Cloudflare R2
  console.log("Uploading files to Cloudflare R2");
  await uploadFiles(videos, platform_id, channel_id);

  // purge cache
  console.log("Purging Cloudflare cache");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${D1_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [
          `https://${R2_BUCKET_CUSTOM_DOMAIN}/${platform_id}/${channel_id}/index.json`,
          `https://${R2_BUCKET_CUSTOM_DOMAIN}/${platform_id}/${channel_id}/transcripts.zip`,
          `https://${R2_BUCKET_CUSTOM_DOMAIN}/${platform_id}/${channel_id}/pagefind/pagefind-entry.json`,
        ],
      }),
    }
  );

  console.log(await response.json());

  // Update status to complete
  console.log("Updating job status to complete");
  await updateJobStatus(platform_id, channel_id, 3);
}

async function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

function parseVideoList(rawData) {
  const lines = rawData.trim().split("\n");
  return lines.map((line) => {
    const { id, title, upload_date, url } = JSON.parse(line);
    return { id, title, upload_date, url };
  });
}

async function writeIndexJson(videos, outputPath) {
  let prevDate = 0;
  const indexData = [
    Math.floor(Date.now() / (24 * 60 * 60 * 1000)),
    videos.map((video) => {
      let videoDateDays = prevDate;
      if (video.upload_date && !isNaN(video.upload_date)) {
        const videoDate = new Date(
          parseInt(video.upload_date.slice(0, 4)),
          parseInt(video.upload_date.slice(4, 6)) - 1,
          parseInt(video.upload_date.slice(6, 8))
        );
        videoDateDays = Math.floor(videoDate.getTime() / (24 * 60 * 60 * 1000));
        prevDate = videoDateDays;
      }
      const data = [video.id, video.title, videoDateDays, video.language || ""];
      if (video.missingTranscript === true) {
        data.push(0);
      }
      return data;
    }),
  ];
  fs.writeFileSync(outputPath, JSON.stringify(indexData));
}

function indexArrToObj(indexArr) {
  return indexArr[1].reduce((obj, video) => {
    obj[video[0]] = {
      id: video[0],
      title: video[1],
      date: new Date(video[2] * 24 * 60 * 60 * 1000),
      language: video.length > 3 ? video[3] : "en",
    };
    return obj;
  }, {});
}

async function zipFolder(folderPath, outputPath) {
  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(folderPath, false);
  await archive.finalize();
}

async function uploadFiles(
  videos,
  platform_id,
  channel_id,
  download_only = false
) {
  const folderPath = `tmp/${platform_id.toString()}/${channel_id}`;

  const searchBundlePath = `${folderPath}/pagefind`;
  const indexJsonPath = `${folderPath}/index.json`;
  const transcriptsZipPath = `${folderPath}/transcripts.zip`;
  const transcriptsFolder = `${folderPath}/transcripts`;

  const bucketName = R2_BUCKET_NAME;

  // Upload index.json
  if (fs.existsSync(indexJsonPath)) {
    const fileContent = fs.readFileSync(indexJsonPath);
    const key = `${platform_id}/${channel_id}/index.json`;
    await s3
      .putObject({
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
      })
      .promise();
  }

  const newVideos = videos.filter((video) => video.newTranscript === true);
  if (newVideos.length === 0) {
    return;
  }

  // Upload search bundle
  if (!download_only && fs.existsSync(searchBundlePath)) {
    const files = globSync(`${searchBundlePath}/**/*`, {
      nodir: true,
      posix: true,
    });
    for (const filePath of files) {
      if (filePath.endsWith(".js") || filePath.endsWith(".css")) continue;
      const fileContent = fs.readFileSync(filePath);
      const key = filePath.substring(4); // assume tmp/ is the prefix
      await s3
        .putObject({
          Bucket: bucketName,
          Key: key,
          Body: fileContent,
        })
        .promise();
    }
  }

  // Upload transcripts.zip
  if (fs.existsSync(transcriptsZipPath)) {
    const fileContent = fs.readFileSync(transcriptsZipPath);
    const key = `${platform_id}/${channel_id}/transcripts.zip`;
    await s3
      .putObject({
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
      })
      .promise();
  }

  // Upload new transcripts (JSON files only)
  for (const video of newVideos) {
    // Upload JSON file
    const transcriptJsonFile = `${transcriptsFolder}/${video.id}.json`;
    const jsonContent = fs.readFileSync(transcriptJsonFile);
    const jsonKey = `${platform_id}/transcripts/${video.id}.json`;
    await s3
      .putObject({
        Bucket: bucketName,
        Key: jsonKey,
        Body: jsonContent,
      })
      .promise();
  }
}

function createTranscriptArrayFromSrv1(parsedTranscript) {
  const transcriptArray = [];
  if (parsedTranscript.transcript && parsedTranscript.transcript.text) {
    const textsArray = Array.isArray(parsedTranscript.transcript.text)
      ? parsedTranscript.transcript.text
      : [parsedTranscript.transcript.text];

    for (const textEntry of textsArray) {
      const start = parseFloat(textEntry["@_start"]) || 0;
      const dur = parseFloat(textEntry["@_dur"]) || 0;
      let text = textEntry["#text"] || "";
      // Decode HTML entities
      text = decode(text, { scope: "strict" });
      transcriptArray.push([start, dur, text]);
    }
  }
  return transcriptArray;
}

export { createTranscriptArrayFromSrv1 };

async function main() {
  while (true) {
    let job = null;
    try {
      job = await fetchAndUpdateOldestJobWithStatus(0, 1);
    } catch (error) {
      console.error("Error fetching job:", error);
    }
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait for 60 seconds
      continue;
    }

    try {
      await processJob(job);
    } catch (error) {
      console.error("Error processing job:", error);
      try {
        await updateJobStatus(job.platform_id, job.channel_id, 4); // Update status to failed
      } catch (error) {
        console.error("Error updating job status:", error);
      }
    }
  }
}

main();

//clear s3 bucket
// async function clearBucket() {
//   const bucketName = process.env.R2_BUCKET_NAME;
//   const params = {
//     Bucket: bucketName,
//     Prefix: "0/unofficialjonathanblow/transcripts", // Filter at source
//   };

//   const data = await s3.listObjects(params).promise();
//   if (data.Contents.length === 0) return;

//   const deleteParams = {
//     Bucket: bucketName,
//     Delete: {
//       Objects: data.Contents.map((item) => ({ Key: item.Key })),
//     },
//   };

//   await s3.deleteObjects(deleteParams).promise();
//   if (data.IsTruncated) await clearBucket();
// }
// clearBucket();
