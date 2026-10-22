import unittest
from datetime import datetime
from scripts.utils.model import Window, ConfigError, Route
from scripts.catalog.validation import validate_routes

class ConfigTests(unittest.TestCase):
    def test_window_midnight_half_open(self):
        w = Window.parse('2026-10-20T23:00:00', '2026-10-21T01:00:00')
        self.assertEqual(w.dates(), ['2026-10-20', '2026-10-21'])
        self.assertFalse(w.contains('2026-10-21 01:00:00'))
        self.assertTrue(w.contains('2026-10-21 00:00:00'))

    def test_invalid_and_future_windows(self):
        for a,b in [('2026-10-20T09:30:00','2026-10-20T10:00:00'), ('2026-10-21T00:00:00','2026-10-20T00:00:00'), ('2099-01-01T00:00:00','2099-01-02T00:00:00')]:
            with self.assertRaises(ConfigError): Window.parse(a,b)

    def test_rejects_cross_product_policy_scope(self):
        a = Route('a','p1','r1','pingan','c','',{'channel':'X'})
        b = Route('b','p2','r2','pingan','c','',{'channel':'X'})
        with self.assertRaises(ConfigError): validate_routes([a,b], {'c': {'source':'pingan'}})

    def test_shared_ad_account_requires_explicit_scope(self):
        a = Route('a','p1','r1','marketing','c','123',{})
        with self.assertRaises(ConfigError): validate_routes([a], {'c': {'source':'marketing'}})

    def test_boolean_settings_and_sms_schema_are_strict(self):
        import tempfile
        from pathlib import Path
        from scripts.utils.config import Config
        base="[credentials.m]\nsource='marketing'\nenv_prefix='M_'\n"
        for extra in ["[settings]\nalert_on_error='false'\n", "[sms]\nenabled='false'\n", "[sms]\nenabled=true\nphone_numbers=['13800000000']\n"]:
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'c.toml'; path.write_text(base+extra)
                with self.assertRaises(ConfigError): Config.load(path)

    def test_hidden_qianchuan_scope_and_ambiguous_id_namespaces_rejected(self):
        a=Route('a','p1','r1','qianchuan','c','123',{'aweme_id':'phone123'})
        b=Route('b','p2','r2','qianchuan','c','123',{'aweme_ids':['987']})
        with self.assertRaises(ConfigError): validate_routes([a,b],{'c':{'source':'qianchuan'}})
        hidden=Route('h','p1','r1','qianchuan','c','123',{'account_scope':True,'filtering':{'aweme_ids':[987]}})
        with self.assertRaises(ConfigError): validate_routes([hidden],{'c':{'source':'qianchuan'}})

    def test_ping_an_platform_cannot_hide_duplicate_channel(self):
        a=Route('a','p1','r1','pingan','c','',{'channel':'X','platform':'A'})
        b=Route('b','p2','r2','pingan','c','',{'channel':'X','platform':'B'})
        with self.assertRaises(ConfigError): validate_routes([a,b],{'c':{'source':'pingan'}})

    def test_qianchuan_numeric_id_spellings_have_one_scope(self):
        for first,second in [(['987'],[987]),(['987'],['000987'])]:
            a=Route('a','p1','r1','qianchuan','c','123',{'aweme_ids':first})
            b=Route('b','p2','r2','qianchuan','c','123',{'aweme_ids':second})
            with self.assertRaises(ConfigError): validate_routes([a,b],{'c':{'source':'qianchuan'}})
