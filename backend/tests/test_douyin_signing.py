import hashlib
import random
import unittest
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit


EXTERNAL_DIR = Path(__file__).resolve().parents[2] / "3rd" / "douyin_api"
if str(EXTERNAL_DIR) not in sys.path:
    sys.path.insert(0, str(EXTERNAL_DIR))

from crawlers.douyin.web import websign
from crawlers.douyin.web.abogus_v2 import ABogus, ALPHABETS
from crawlers.douyin.web.web_crawler import DouyinWebCrawler
from crawlers.utils.api_exceptions import APIUnauthorizedError


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


class DouyinSigningTests(unittest.TestCase):
    def test_current_a_bogus_has_expected_shape(self):
        value = ABogus(USER_AGENT, rng=random.Random(9)).get_value(
            "aid=6383&aweme_id=7675505205047348543",
            now_ms=1_789_000_000_000,
        )

        self.assertGreaterEqual(len(value), 180)
        self.assertEqual(len(value) % 4, 0)
        self.assertLessEqual(set(value), set(ALPHABETS["s4"] + "="))

    def test_websign_covers_encoded_query_and_visitor(self):
        query, signature, headers = websign.sign(
            [("aweme_id", "123"), ("a_bogus", "a+b/c")],
            "visitor-1",
            timestamp=1_788_848_901,
        )
        covered = query.rpartition(f"&{websign.SIGNATURE_PARAM}=")[0]
        expected = hashlib.md5(
            f"visitor-1_1788848901_{websign.SALT}_{covered}".encode()
        ).hexdigest()

        self.assertEqual(signature, expected)
        self.assertIn("a_bogus=a%2Bb%2Fc", covered)
        self.assertIn("uifid=visitor-1", covered)
        self.assertEqual(headers[websign.EXPIRE_HEADER], "1788848901")

    def test_protected_endpoint_adds_both_signature_layers(self):
        headers = {
            "User-Agent": USER_AGENT,
            "Cookie": "UIFID_TEMP=visitor-1; s_v_web_id=verify_abc",
        }
        endpoint = DouyinWebCrawler._signed_endpoint(
            "https://www.douyin.com/aweme/v1/web/aweme/detail/",
            {"aid": "6383", "aweme_id": "123", "msToken": ""},
            headers,
        )
        params = parse_qs(urlsplit(endpoint).query, keep_blank_values=True)

        self.assertIn("a_bogus", params)
        self.assertEqual(params["verifyFp"], ["verify_abc"])
        self.assertEqual(params["fp"], ["verify_abc"])
        self.assertEqual(params["uifid"], ["visitor-1"])
        self.assertIn(websign.SIGNATURE_PARAM, params)
        self.assertIn(websign.SIGNATURE_PARAM, headers)
        self.assertIn(websign.EXPIRE_HEADER, headers)

    def test_protected_endpoint_requires_complete_cookie(self):
        with self.assertRaisesRegex(APIUnauthorizedError, "UIFID_TEMP"):
            DouyinWebCrawler._signed_endpoint(
                "https://www.douyin.com/aweme/v1/web/aweme/detail/",
                {"aid": "6383", "aweme_id": "123"},
                {"User-Agent": USER_AGENT, "Cookie": "ttwid=visitor"},
            )


if __name__ == "__main__":
    unittest.main()
