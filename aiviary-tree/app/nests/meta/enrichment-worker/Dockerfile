# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies (libmagic for python-magic, ffmpeg for audio extraction)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libmagic1 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy the requirements file into the container
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code into the container
COPY . .

# Run main.py when the container launches
CMD ["python", "-u", "main.py"]