import json
import unittest
from unittest.mock import MagicMock, patch

import httpx

from utils import extract_share_url, get_url_platform
from xiaohongshu import fetch_xiaohongshu_video_profile


class XiaohongshuProfileTests(unittest.TestCase):
    @staticmethod
    def _response(note: dict) -> MagicMock:
        state = {"note": {"noteDetailMap": {note["noteId"]: {"note": note}}}}
        response = MagicMock()
        response.url = httpx.URL(
            f"https://www.xiaohongshu.com/explore/{note['noteId']}?xsec_token=test-token"
        )
        response.text = (
            "<html><script>window.__INITIAL_STATE__="
            f"{json.dumps(state, ensure_ascii=False)}"
            ";</script></html>"
        )
        response.raise_for_status.return_value = None
        return response

    def test_extracts_image_note(self):
        note = {
            "noteId": "67f123456789abcdef012345",
            "type": "normal",
            "title": "测试图文",
            "desc": "图文描述",
            "time": 1_750_000_000_000,
            "user": {
                "userId": "xhs-user-1",
                "nickname": "测试作者",
                "avatar": "https://sns-avatar.example/avatar.jpg",
            },
            "imageList": [
                {"urlDefault": "https://sns-img.example/01.webp"},
                {"urlDefault": "https://sns-img.example/02.webp"},
            ],
        }
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = self._response(note)

        with patch("xiaohongshu.httpx.Client", return_value=client):
            profile = fetch_xiaohongshu_video_profile(
                "https://www.xiaohongshu.com/explore/67f123456789abcdef012345?xsec_token=test-token"
            )

        self.assertEqual(profile["aweme_type"], 68)
        self.assertEqual(profile["desc"], "测试图文")
        self.assertEqual(len(profile["images"]["url_list"]), 2)
        self.assertEqual(profile["author"]["uid"], "xhs-user-1")
        self.assertEqual(profile["create_time"], 1_750_000_000)

    def test_extracts_video_note(self):
        note = {
            "noteId": "67fabcdef012345678901234",
            "type": "video",
            "title": "测试视频",
            "user": {"userId": "xhs-user-2", "nickname": "视频作者"},
            "imageList": [{"urlDefault": "https://sns-img.example/cover.webp"}],
            "video": {"consumer": {"originVideoKey": "video/test.mp4"}},
        }
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = self._response(note)

        with patch("xiaohongshu.httpx.Client", return_value=client):
            profile = fetch_xiaohongshu_video_profile(
                "https://www.xiaohongshu.com/explore/67fabcdef012345678901234?xsec_token=test-token"
            )

        self.assertEqual(profile["aweme_type"], 0)
        self.assertEqual(profile["images"]["url_list"], [])
        self.assertEqual(
            profile["video"]["play_addr"]["url_list"][0],
            "https://sns-video-bd.xhscdn.com/video/test.mp4",
        )

    def test_preserves_short_link_query(self):
        url = extract_share_url(
            "复制这条消息 xhslink.com/m/example123?xsec_source=app_share&type=normal 打开小红书"
        )
        self.assertEqual(
            url,
            "https://xhslink.com/m/example123?xsec_source=app_share&type=normal",
        )
        self.assertEqual(get_url_platform(url), "xiaohongshu")


if __name__ == "__main__":
    unittest.main()
