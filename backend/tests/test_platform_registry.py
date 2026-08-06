import unittest
from unittest.mock import MagicMock, patch

from platforms import (
    detect_platform,
    extract_supported_url,
    get_adapter,
    iter_adapters,
)
from platforms.douyin import DouyinAdapter


class PlatformRegistryTests(unittest.TestCase):
    def test_detects_supported_platforms(self):
        cases = {
            "https://v.douyin.com/example": "douyin",
            "https://www.tiktok.com/@author/video/123": "tiktok",
            "https://v.kuaishou.com/example": "kuaishou",
            "https://www.xiaohongshu.com/explore/123": "xiaohongshu",
            "http://xhslink.cn/o/example": "xiaohongshu",
        }

        for url, expected in cases.items():
            with self.subTest(url=url):
                self.assertEqual(detect_platform(url), expected)

    def test_extracts_supported_url_and_preserves_query(self):
        url = extract_supported_url(
            "复制 xhslink.com/m/example?xsec_token=token&type=normal 打开小红书"
        )
        self.assertEqual(
            url,
            "https://xhslink.com/m/example?xsec_token=token&type=normal",
        )

        self.assertEqual(
            extract_supported_url("http://xhslink.cn/o/example"),
            "http://xhslink.cn/o/example",
        )

    def test_capabilities_are_declared_by_adapter(self):
        self.assertTrue(get_adapter("kuaishou").capabilities.cursor_backfill)
        self.assertTrue(get_adapter("kuaishou").capabilities.direct_media_download)
        self.assertFalse(get_adapter("xiaohongshu").capabilities.subscriptions)
        self.assertTrue(get_adapter("xiaohongshu").capabilities.animated_image_media)
        self.assertTrue(get_adapter("douyin").capabilities.subscriptions)
        self.assertTrue(get_adapter("tiktok").capabilities.subscriptions)

    def test_registry_contains_each_platform_once(self):
        slugs = [adapter.slug for adapter in iter_adapters()]
        self.assertEqual(slugs, ["douyin", "tiktok", "kuaishou", "xiaohongshu"])
        self.assertEqual(len(slugs), len(set(slugs)))

    def test_douyin_animated_image_uses_image_video_stream(self):
        profile = {
            "share_url": "https://www.douyin.com/note/example",
            "images": [{
                "url_list": ["https://cdn.example/static.webp"],
                "video": {
                    "play_addr": {"url_list": ["https://cdn.example/motion.mp4"]},
                },
            }],
        }
        video_response = MagicMock()
        video_response.headers = {"content-type": "video/mp4"}
        video_response.content = b"0" * 2048
        video_response.raise_for_status.return_value = None
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = video_response

        adapter = DouyinAdapter()
        self.assertTrue(adapter.has_animated_image_media(profile))
        with patch("platforms.douyin.httpx.Client", return_value=client):
            media, _ = adapter.download_images("https://v.douyin.com/example", profile=profile)

        self.assertEqual([item[0] for item in media], ["01.mp4"])
        self.assertEqual(media[0][2], "video/mp4")
        client.get.assert_called_once_with("https://cdn.example/motion.mp4")


if __name__ == "__main__":
    unittest.main()
