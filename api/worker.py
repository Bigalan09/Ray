"""Background worker process.

Runs the scheduler and processes background tasks.
Start with: python -m worker
"""
from __future__ import annotations

import asyncio
import os
import sys

# Ensure the api directory is in the path
sys.path.insert(0, os.path.dirname(__file__))

from tasks.scheduler import start_scheduler, stop_scheduler


async def main():
    print("Ray Worker starting...")

    scheduler = start_scheduler()
    print("Scheduler started. Waiting for jobs...")

    try:
        # Sleep in a loop so KeyboardInterrupt can be caught on all platforms
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\nShutting down worker...")
    finally:
        stop_scheduler()
        print("Worker stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
