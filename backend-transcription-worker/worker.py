import os
import time
import json
import shutil
import subprocess
from glob import glob
from datetime import datetime
from zipfile import ZipFile
from botocore.exceptions import ClientError
import requests
import boto3
import asyncio
from pagefind.index import PagefindIndex, IndexConfig
import nemo.collections.asr as nemo_asr
from dotenv import load_dotenv
from silero_vad import load_silero_vad, read_audio, get_speech_timestamps

load_dotenv()

# Add new environment variables for account ID and database ID
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID")
D1_DATABASE_ID = os.getenv("D1_DATABASE_ID")

# Construct the D1 API endpoint URL
D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/raw"

# Configure Cloudflare R2 using the account ID
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
    region_name="auto",
)

# D1 REST API configuration
D1_API_TOKEN = os.getenv("D1_API_TOKEN")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")

# Load models
vad_model = load_silero_vad()
asr_model = nemo_asr.models.ASRModel.from_pretrained(
    model_name="nvidia/parakeet-tdt_ctc-110m"
)


def fetch_and_update_oldest_job_with_status(status, new_status):
    transaction = """
    WITH selected_job AS (
      SELECT * FROM transcription_jobs
      WHERE job_state = ? 
      ORDER BY queued ASC 
      LIMIT 1
    )
    UPDATE transcription_jobs
    SET job_state = ?
    WHERE (platform_id, content_id) IN (SELECT platform_id, content_id FROM selected_job)
    RETURNING *;
    """

    payload = {
        "params": [status, new_status],
        "sql": transaction,
    }

    headers = {
        "Authorization": f"Bearer {D1_API_TOKEN}",
        "Content-Type": "application/json",
    }

    response = requests.post(D1_API_URL, headers=headers, json=payload)
    data = response.json()
    print(json.dumps(data))

    # Check if response has expected structure
    if (
        not data.get("result")
        or not data["result"][0]["results"].get("columns")
        or not data["result"][0]["results"].get("rows")
    ):
        return None

    columns = data["result"][0]["results"]["columns"]
    rows = data["result"][0]["results"]["rows"]

    # Return null if no rows returned
    if len(rows) == 0:
        return None

    # Convert first row to dict using column names as keys
    result = dict(zip(columns, rows[0]))

    return result


def update_job_status(platform_id, content_id, new_status):
    transaction = """
    UPDATE transcription_jobs
    SET job_state = ?
    WHERE platform_id = ? AND content_id = ?;
    """

    payload = {
        "params": [new_status, platform_id, content_id],
        "sql": transaction,
    }

    headers = {
        "Authorization": f"Bearer {D1_API_TOKEN}",
        "Content-Type": "application/json",
    }

    response = requests.post(D1_API_URL, headers=headers, json=payload)
    data = response.json()
    print(json.dumps(data))

    # Check if response has expected structure
    if (
        not data.get("result")
        or not data["result"][0]["results"].get("columns")
        or not data["result"][0]["results"].get("rows")
    ):
        return None

    columns = data["result"][0]["results"]["columns"]
    rows = data["result"][0]["results"]["rows"]

    # Return null if no rows returned
    if len(rows) == 0:
        return None

    # Convert first row to dict using column names as keys
    result = dict(zip(columns, rows[0]))

    return result


def process_job(job):
    print(
        f"Starting processing job for platform_id: {job['platform_id']}, content_id: {job['content_id']}"
    )
    platform_id = job["platform_id"]
    channel_id = job["channel_id"]
    content_id = job["content_id"]
    build_index = job.get("build_index", True)

    saved_video_data = {}
    print("Attempting to download index.json from Cloudflare R2")
    try:
        params = {
            "Bucket": R2_BUCKET_NAME,
            "Key": f"{platform_id}/{channel_id}/index.json",
        }
        response = s3.get_object(**params)
        data = response["Body"].read().decode("utf-8")
        saved_video_data = index_arr_to_obj(json.loads(data))
        print("index.json downloaded successfully")
    except ClientError as e:
        if e.response["Error"]["Code"] != "NoSuchKey":
            print("Error downloading index.json:", e)
        print("No existing index.json found, proceeding...")

    channel_folder = f"tmp/{platform_id}/{channel_id}"
    # Attempt to download transcripts.zip from Cloudflare R2
    print("Attempting to download transcripts.zip from Cloudflare R2")
    try:
        params = {
            "Bucket": R2_BUCKET_NAME,
            "Key": f"{platform_id}/{channel_id}/transcripts.zip",
        }
        response = s3.get_object(**params)
        zip_path = channel_folder + "/transcripts.zip"

        os.makedirs(channel_folder + "/transcripts", exist_ok=True)

        # Write zip file
        with open(zip_path, "wb") as f:
            f.write(response["Body"].read())

        # Extract zip contents
        with ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(channel_folder + "/transcripts")

        print("transcripts.zip downloaded and extracted successfully")

        # Delete the zip file
        os.remove(zip_path)

    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            print("No existing transcripts.zip found, proceeding...")
        else:
            raise e

    stream_url = ""
    if platform_id == 0:  # youtube
        stream_url = f"https://www.youtube.com/watch?v={content_id}"
    elif platform_id == 1:  # twitch
        stream_url = f"https://www.twitch.tv/videos/{content_id}"
    print("Downloading stream " + stream_url)

    # Capture command output
    output = subprocess.check_output(
        [
            "yt-dlp",
            "--dump-json",
            "--no-simulate",
            "-f",
            "worstaudio*",
            "-x",
            "--audio-format",
            "wav",
            "-o",
            "temp.wav",
            stream_url,
        ],
        stderr=subprocess.PIPE,  # Capture stderr as well
    )

    # Convert bytes to string and parse JSON
    video_info = json.loads(output.decode("utf-8"))
    print("Downloaded stream successfully")
    saved_video_data[content_id] = {
        "id": content_id,
        "title": video_info["title"],
        "upload_date": video_info["upload_date"],
        "language": "en",
    }

    subprocess.call(
        [
            "ffmpeg",
            "-i",
            "temp.wav",
            "-ac",
            "1",
            "-ar",
            "16000",
            f"{content_id}.wav",
        ]
    )
    os.remove("temp.wav")

    # Load audio
    print("Loading audio")
    wav = read_audio(f"{content_id}.wav")

    # Get speech timestamps
    speech_timestamps = get_speech_timestamps(
        wav,
        vad_model,
        return_seconds=False,
        max_speech_duration_s=600,
    )

    # Extract speech chunks
    speech_chunks = [
        wav[res["start"] : res["end"]].numpy() for res in speech_timestamps
    ]

    # Transcribe speech chunks
    transcriptions = asr_model.transcribe(speech_chunks)[0]

    # Prepare transcription data
    transcript_arr = [
        [
            round(res["start"] / 16000, 2),
            round((res["end"] - res["start"]) / 16000, 2),
            transcriptions[i],
        ]
        for i, res in enumerate(speech_timestamps)
    ]

    # Save transcription to JSON file
    transcripts_folder = f"tmp/{platform_id}/{channel_id}/transcripts"
    os.makedirs(transcripts_folder, exist_ok=True)
    with open(f"{transcripts_folder}/{content_id}.json", "w", encoding="utf-8") as f:
        json.dump(transcript_arr, f)
    os.remove(f"{content_id}.wav")

    # Upload transcript to Cloudflare R2
    print("Uploading transcript to Cloudflare R2")
    s3.upload_file(
        f"{transcripts_folder}/{content_id}.json",
        R2_BUCKET_NAME,
        f"{platform_id}/{channel_id}/transcripts/{content_id}.json",
    )

    # Zip transcripts folder
    print("Zipping transcripts folder")
    zip_folder(transcripts_folder, f"{channel_folder}/transcripts.zip")

    # Upload transcripts.zip to Cloudflare R2
    print("Uploading transcripts.zip to Cloudflare R2")
    s3.upload_file(
        f"{channel_folder}/transcripts.zip",
        R2_BUCKET_NAME,
        f"{platform_id}/{channel_id}/transcripts.zip",
    )
    os.remove(f"{channel_folder}/transcripts.zip")

    # write index.json
    print("Writing index.json")
    write_index_json(saved_video_data, f"{channel_folder}/index.json")

    # Upload index.json to Cloudflare R2
    print("Uploading index.json to Cloudflare R2")
    s3.upload_file(
        f"{channel_folder}/index.json",
        R2_BUCKET_NAME,
        f"{platform_id}/{channel_id}/index.json",
    )

    print("Generating and uploading search index")
    asyncio.run(
        create_pagefind_index(
            transcripts_folder, f"{channel_folder}/pagefind", saved_video_data
        )
    )

    # Delete old pagefind index files from Cloudflare R2
    pagefind_folder = f"{platform_id}/{channel_id}/pagefind"
    response = s3.list_objects_v2(Bucket=R2_BUCKET_NAME, Prefix=pagefind_folder)
    keys_to_delete = set()
    for obj in response.get("Contents", []):
        keys_to_delete.add(obj["Key"])

    # Upload Pagefind index files
    pagefind_index_path = f"{channel_folder}/pagefind"
    if os.path.exists(pagefind_index_path):
        for root, dirs, files in os.walk(pagefind_index_path):
            for file in files:
                # skip .js and .css files
                if file.endswith(".js") or file.endswith(".css"):
                    continue
                file_path = os.path.join(root, file)
                relative_path = os.path.relpath(file_path, pagefind_index_path)
                object_key = f"{platform_id}/{channel_id}/pagefind/{relative_path}"
                if object_key in keys_to_delete:
                    keys_to_delete.remove(object_key)
                s3.upload_file(
                    file_path,
                    R2_BUCKET_NAME,
                    object_key,
                )

    # Delete old pagefind index files
    print("Deleting old pagefind index files")
    for key in keys_to_delete:
        s3.delete_object(Bucket=R2_BUCKET_NAME, Key=key)

    # Update job status to completed
    print("Updating job status to completed")
    update_job_status(platform_id, content_id, 2)


async def create_pagefind_index(transcripts_folder, output_path, video_info):
    config = IndexConfig(
        logfile="index.log",
        output_path=output_path,
    )
    async with PagefindIndex(config=config) as index:
        transcript_files = glob(os.path.join(transcripts_folder, "*.json"))
        for transcript_file in transcript_files:
            with open(transcript_file, "r", encoding="utf-8") as f:
                content = json.load(f)
                text_content = " ".join([entry[2] for entry in content])
            video_id = os.path.splitext(os.path.basename(transcript_file))[0]
            await index.add_custom_record(
                url=video_id,
                content=text_content,
                language="en",
                meta={"title": video_info[video_id]["title"]},
                sort={"date": video_info[video_id]["upload_date"]},
            )
        await index.write_files()


def write_index_json(videos, output_path):
    prev_date = 0
    index_data = [
        int(time.time() // (24 * 60 * 60)),
        [
            [
                video["id"],
                video["title"],
                (
                    int(
                        prev_date := datetime.strptime(
                            video["upload_date"], "%Y%m%d"
                        ).timestamp()
                        // (24 * 60 * 60)
                    )
                    if video.get("upload_date")
                    else prev_date
                ),
                video.get("language", ""),
            ]
            + ([0] if video.get("missingTranscript") else [])
            for video in videos.values()
        ],
    ]
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f)


def index_arr_to_obj(index_arr):
    return {
        video[0]: {
            "id": video[0],
            "title": video[1],
            "upload_date": datetime.fromtimestamp(video[2] * 24 * 60 * 60),
            "language": video[3] if len(video) > 3 else "en",
            "missingTranscript": True if len(video) > 4 else False,
        }
        for video in index_arr[1]
    }


def zip_folder(folder_path, output_path):
    shutil.make_archive(output_path.replace(".zip", ""), "zip", folder_path)


def main():
    while True:
        job = None
        try:
            job = fetch_and_update_oldest_job_with_status(0, 1)
        except Exception as error:
            print("Error fetching job:", error)
        if not job:
            time.sleep(60)  # Wait for 60 seconds
            continue

        try:
            process_job(job)
        except Exception as error:
            print("Error processing job:", error)
            try:
                update_job_status(
                    job["platform_id"], job["content_id"], 3  # Update status to failed
                )
            except Exception as e:
                print("Error updating job status:", e)


# Uncomment to run the main loop
main()
