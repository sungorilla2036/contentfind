import os
import time
import json
import shutil
import subprocess
from glob import glob
from datetime import datetime
from zipfile import ZipFile

import requests
import boto3
import asyncio
from pagefind.index import PagefindIndex, IndexConfig
import nemo.collections.asr as nemo_asr
from dotenv import load_dotenv

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


def fetch_and_update_oldest_job_with_status(status, new_status):
    transaction = """
    WITH selected_job AS (
      SELECT * FROM transcription_jobs
      WHERE job_state = %s 
      ORDER BY queued ASC 
      LIMIT 1
    )
    UPDATE transcription_jobs
    SET job_state = %s
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
    SET job_state = %s
    WHERE platform_id = %s AND content_id = %s;
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
    content_id = job["content_id"]
    build_index = job.get("build_index", False)

    stream_url = ""
    if platform_id == 0:  # youtube
        stream_url = f"https://www.youtube.com/watch?v={content_id}"
    elif platform_id == 1:  # twitch
        stream_url = f"https://www.twitch.tv/videos/{content_id}"
    print("Downloading stream")
    subprocess.call(
        [
            "yt-dlp",
            "-f",
            "worstaudio*",
            "-x",
            "--audio-format",
            "wav",
            "-o",
            "temp.wav",
            stream_url,
        ]
    )
    print("Converting to 16kHz mono WAV")
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

    # Transcribe using NVIDIA NeMo's Parakeet ASR model
    print("Transcribing audio with NVIDIA NeMo")
    asr_model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(
        model_name="nvidia/parakeet-tdt-1.1b"
    )
    transcription = asr_model.transcribe([f"{content_id}.wav"], return_hypothesis=True)[
        0
    ]

    # Save transcription to JSON file
    transcript_data = [{"start": 0, "dur": 0, "text": transcription}]
    transcripts_folder = f"tmp/{platform_id}/{content_id}/transcripts"
    os.makedirs(transcripts_folder, exist_ok=True)
    with open(f"{transcripts_folder}/{content_id}.json", "w", encoding="utf-8") as f:
        json.dump(transcript_data, f)
    os.remove(f"{content_id}.wav")

    # Zip transcripts folder
    print("Zipping transcripts folder")
    channel_folder = f"tmp/{platform_id}/{content_id}"
    zip_folder(transcripts_folder, f"{channel_folder}/transcripts.zip")

    # Upload transcripts.zip to Cloudflare R2
    print("Uploading transcripts.zip to Cloudflare R2")
    s3.upload_file(
        f"{channel_folder}/transcripts.zip",
        os.getenv("R2_BUCKET_NAME"),
        f"{platform_id}/{content_id}/transcripts.zip",
    )

    # Generate and upload search index if build_index is True
    if build_index:
        print("Generating and uploading search index")
        asyncio.run(create_pagefind_index(transcripts_folder))
        upload_search_index(platform_id, content_id, transcripts_folder)

    # Update job status to completed
    print("Updating job status to completed")
    update_job_status(platform_id, content_id, 2)


async def create_pagefind_index(transcripts_folder):
    config = IndexConfig(
        root_selector="main",
        logfile="index.log",
        output_path=os.path.join(transcripts_folder, "pagefind"),
        verbose=True,
    )
    async with PagefindIndex(config=config) as index:
        transcript_files = glob(os.path.join(transcripts_folder, "*.json"))
        for transcript_file in transcript_files:
            with open(transcript_file, "r", encoding="utf-8") as f:
                content = json.load(f)
                text_content = "\n".join([entry[2] for entry in content])
            video_id = os.path.splitext(os.path.basename(transcript_file))[0]
            html_content = (
                "<html>"
                "  <body>"
                "    <main>"
                f"      <h1>Video {video_id}</h1>"
                f"      <p>{text_content}</p>"
                "    </main>"
                "  </body>"
                "</html>"
            )
            await index.add_html_file(
                content=html_content,
                url=f"https://www.youtube.com/watch?v={video_id}",
                source_path=transcript_file,
            )
        await index.get_files()


def exec_command(command):
    result = subprocess.run(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if result.returncode != 0:
        raise Exception(result.stderr)
    return result.stdout.strip()


def parse_video_list(raw_data):
    lines = raw_data.strip().split("\n")
    videos = []
    for line in lines:
        data = json.loads(line)
        videos.append(
            {
                "id": data.get("id"),
                "title": data.get("title"),
                "upload_date": data.get("upload_date"),
                "url": data.get("url"),
            }
        )
    return videos


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
            for video in videos
        ],
    ]
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f)


def index_arr_to_obj(index_arr):
    return {
        video[0]: {
            "date": datetime.utcfromtimestamp(video[2] * 24 * 60 * 60),
            "language": video[3] if len(video) > 3 else "en",
        }
        for video in index_arr[1]
    }


def zip_folder(folder_path, output_path):
    shutil.make_archive(output_path.replace(".zip", ""), "zip", folder_path)


def upload_files(videos, platform_id, channel_id, download_only=False):
    folder_path = f"tmp/{platform_id}/{channel_id}"

    index_json_path = f"{folder_path}/index.json"
    transcripts_zip_path = f"{folder_path}/transcripts.zip"
    transcripts_folder = f"{folder_path}/transcripts"

    bucket_name = os.getenv("R2_BUCKET_NAME")

    # Upload index.json
    if os.path.exists(index_json_path):
        s3.upload_file(
            index_json_path, bucket_name, f"{platform_id}/{channel_id}/index.json"
        )

    new_videos = [video for video in videos if video.get("newTranscript")]
    if not new_videos:
        return

    # Upload transcripts.zip
    if os.path.exists(transcripts_zip_path):
        s3.upload_file(
            transcripts_zip_path,
            bucket_name,
            f"{platform_id}/{channel_id}/transcripts.zip",
        )

    # Upload new transcripts (JSON files only)
    for video in new_videos:
        transcript_json_file = f"{transcripts_folder}/{video['id']}.json"
        if os.path.exists(transcript_json_file):
            s3.upload_file(
                transcript_json_file,
                bucket_name,
                f"{platform_id}/{channel_id}/transcripts/{video['id']}.json",
            )

    # Upload Pagefind index files
    pagefind_index_path = os.path.join(transcripts_folder, "pagefind")
    if os.path.exists(pagefind_index_path):
        for root, dirs, files in os.walk(pagefind_index_path):
            for file in files:
                file_path = os.path.join(root, file)
                relative_path = os.path.relpath(file_path, pagefind_index_path)
                s3.upload_file(
                    file_path,
                    bucket_name,
                    f"{platform_id}/{channel_id}/pagefind/{relative_path}",
                )


def clear_bucket():
    bucket_name = os.getenv("R2_BUCKET_NAME")
    response = s3.list_objects_v2(Bucket=bucket_name)
    if "Contents" in response:
        delete_keys = {"Objects": [{"Key": obj["Key"]} for obj in response["Contents"]]}
        s3.delete_objects(Bucket=bucket_name, Delete=delete_keys)
        if response.get("IsTruncated"):
            clear_bucket()


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
# main()

# Clear S3 bucket
# clear_bucket()

import nemo.collections.asr as nemo_asr

asr_model = nemo_asr.models.ASRModel.from_pretrained(
    model_name="nvidia/parakeet-tdt_ctc-110m"
)

print(asr_model.transcribe(["temp.wav"], timestamps=True))
