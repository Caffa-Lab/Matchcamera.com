"""Regression checks for thousands separators in official weight specifications."""
import unittest

from refresh_verified_specs import extract, weight_grams


class VerifiedWeightTests(unittest.TestCase):
    def test_grouped_and_plain_grams(self):
        for text, expected in [
            ('Approximately 1,180 g/2 lb 9.7 oz', 1180),
            ('2,090g', 2090), ('2,000 g', 2000), ('1,005g', 1005),
            ('1,234.5 g', 1234.5), ('1,180', 1180),
            ('746', 746), ('Approx. 746 g', 746), ('31.5g', 31.5),
        ]:
            with self.subTest(text=text):
                self.assertEqual(weight_grams(text), expected)

    def test_first_configuration_is_preserved(self):
        text = 'Approximately 1,180 g (with tripod collar), 998 g (without collar)'
        self.assertEqual(weight_grams(text), 1180)

    def test_tamron_mount_specific_values(self):
        rows = [
            ('1,165g / 41.1oz (Sony)\n1,190g / 42oz (Nikon)', 1165, 1190),
            ('1,155g / 40.7oz (Sony)\n1,180g / 41.6oz (Nikon)', 1155, 1180),
            ('1,725g / 60.8oz (w/o tripod mount) / (Sony)\n1,720g / 60.7oz (w/o tripod mount) / (Nikon)\ntripod mount 155g / 5.5oz', 1725, 1720),
        ]
        for text, sony, nikon in rows:
            for value in [text, text.replace('\n', ' ')]:
                for mount, expected in [('Sony E', sony), ('Nikon Z', nikon)]:
                    with self.subTest(text=value, mount=mount):
                        result = extract({'url': 'https://www.tamron.com/global/consumer/lenses/example/spec.html', 'status': 200, 'rows': [['Weight', value]]}, {'type': '렌즈', 'mount': mount})
                        self.assertEqual(result['무게(g)'], expected)
                        self.assertEqual(result['무게 상세'], value)
                self.assertIsNone(weight_grams(value, 'Fujifilm X'))
                self.assertIsNone(weight_grams(value))
                wrong_mount = extract({'url': 'https://www.tamron.com/global/consumer/lenses/a057/spec.html', 'status': 200, 'rows': [['Weight', value]]}, {'type': '렌즈', 'mount': 'Fujifilm X'})
                self.assertNotIn('무게 상세', wrong_mount)
                self.assertNotIn('무게(g)', wrong_mount)
        fuji = '1,710g / 60.3 oz (w/o tripod mount) / (FUJIFILM)\ntripod mount 155g / 5.5 oz'
        self.assertEqual(weight_grams(fuji, 'Fujifilm X'), 1710)
        self.assertIsNone(weight_grams(fuji, 'Sony E'))

    def test_does_not_parse_a_malformed_number_suffix(self):
        for text in ['1,23 g', '1,180, g', '1,180.2.3g', '2.5kg', '-', 'unknown']:
            with self.subTest(text=text):
                self.assertIsNone(weight_grams(text))

    def test_actual_extractor_keeps_raw_text_and_full_value(self):
        cases = [
            ('https://imaging.nikon.com/imaging/lineup/lens/z-mount/z_70-200mmf28_vr_s2/',
             [['Weight', 'Approximately 1,180 g/2 lb 9.7 oz']], 1180),
            ('https://fujifilm-korea.co.kr/products/id/1361',
             [['모델명', 'GF19-35mmT3.5'], ['무게', '2,090g']], 2090),
            ('https://www.sony.jp/ichigan/products/example/spec.html',
             [['質量 約 (g)', '1,180']], 1180),
        ]
        for url, rows, expected in cases:
            with self.subTest(url=url):
                result = extract({'url': url, 'status': 200, 'rows': rows}, {'type': '렌즈'})
                self.assertEqual(result['무게(g)'], expected)
                self.assertEqual(result['무게 상세'], rows[-1][1])

    def test_body_weight_rules_are_unchanged(self):
        rows = [['Weight', '1,015g']]
        canon = extract({'url': 'https://asia.canon/en/consumer/example', 'status': 200, 'rows': rows}, {'type': '바디'})
        self.assertEqual(canon['무게(g)'], 1015)
        self.assertEqual(canon['무게 기준'], '배터리·메모리카드 포함')
        nikon = extract({'url': 'https://imaging.nikon.com/example', 'status': 200, 'rows': rows}, {'type': '바디'})
        self.assertNotIn('무게(g)', nikon)


if __name__ == '__main__':
    unittest.main()
