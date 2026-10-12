import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
RANKED = (ROOT / "ranked-catalog.js").read_text(encoding="utf-8")
CLIENT = (ROOT / "client-bridge.js").read_text(encoding="utf-8")


class UiContractTests(unittest.TestCase):
    def test_dashboard_tabs_are_wired(self):
        for attr in ("data-dna-view", "data-stats-view", "data-training-view"):
            self.assertIn(attr, HTML, f"{attr} controls missing from index.html")
            self.assertIn(f'[{attr}]', RANKED, f"{attr} has no JS binding")

    def test_research_targets_have_real_hosts(self):
        for element_id in ("eraResearch", "mapperResearch", "oddityResearch", "twinResearch",
                           "dnaGlobalRanking", "dnaSkillLeaderboard", "skillLadder", "weaknessRadar"):
            self.assertRegex(HTML, rf'id="{re.escape(element_id)}"')
            self.assertIn('$("' + element_id + '")', RANKED)
        self.assertNotIn("oddResearch", RANKED)

    def test_optional_ranked_controls_cannot_abort_startup(self):
        fragile = re.findall(r'\$\("[^"]+"\)\.addEventListener', RANKED)
        self.assertEqual([], fragile, "Direct listener on a possibly missing element can abort the module")

    def test_dynamic_result_actions_are_delegated(self):
        for attr in ("data-ranked-detail", "data-mapper-search", "data-local-chart", "data-year-link"):
            self.assertIn(attr, RANKED)
        self.assertIn('document.addEventListener("click"', RANKED)

    def test_observatory_compare_controls_are_wired(self):
        for element_id in ("obsYearA", "obsYearB", "obsMetric", "obsCompareResult"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        self.assertIn("renderEraComparison", RANKED)

    def test_ranked_advanced_filters_are_wired(self):
        for element_id in ("indexedMaxSr", "indexedMaxBpm", "indexedMinAr", "indexedMinOd",
                           "indexedLength", "indexedStatus", "resetRankedFilters", "randomRanked"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)

    def test_ranked_global_search_and_saved_shelves_are_wired(self):
        for element_id in ("globalRankedSearch", "cancelGlobalSearch", "rankedFavorites", "rankedRecentViews"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("globalRankedSearch", "favoriteMaps", "recentViewedMaps",
                      "osl-ranked-favorites", "osl-ranked-recent", "data-share-map"):
            self.assertIn(token, RANKED)

    def test_similarity_explorer_is_wired(self):
        for element_id in ("similaritySeed", "similarityMode", "similarityScope", "similarityLimit",
                           "runSimilarity", "cancelSimilarity", "similarityStatus", "similarityResults"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("data-similarity-seed", "runSimilarityExplorer", "runGlobalDnaSimilarity",
                      "runGlobalMetaSimilarity", "similarityDnaDistance", "similarityMetaDistance"):
            self.assertIn(token, RANKED)

    def test_filter_only_global_search_is_supported(self):
        self.assertIn("검색어 없이 필터 검색 완료", RANKED)
        self.assertIn("rankedMapMatches", RANKED)
        self.assertNotIn("상위 4,000건만 화면 보관", RANKED)

    def test_relation_graph_is_wired(self):
        for element_id in ("relationNodeLimit", "relationDensity", "buildRelationGraph",
                           "expandRelationNode", "resetRelationGraph", "relationGraphStatus",
                           "relationGraph", "relationGraphEdges", "relationGraphNodes",
                           "relationNodeInspector"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("relationKinds", "relationStrength", "relationGraphMaps",
                      "data-relation-node", "buildRelationGraph"):
            self.assertIn(token, RANKED)

    def test_search_workspace_is_wired(self):
        for element_id in ("activeFilterChips", "savedSearchSelect", "saveSearchPreset",
                           "applySavedSearch", "deleteSavedSearch", "copySearchLink",
                           "rankedExportFormat", "exportRankedResults", "rankedSearchHistory"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("osl-ranked-saved-searches", "osl-ranked-search-history",
                      "buildSearchShareUrl", "restoreSearchStateFromUrl",
                      "exportRankedRows", "recordSearchHistory"):
            self.assertIn(token, RANKED)

    def test_practice_route_builder_is_wired(self):
        for element_id in ("trainingRouteSkill", "trainingRouteStars", "trainingRouteMode",
                           "trainingRouteScope", "trainingRouteCount", "buildTrainingRoute",
                           "clearTrainingRoute", "trainingRouteProgressText",
                           "trainingRouteProgressBar", "trainingRouteStatus", "trainingRouteList"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("osl-training-route", "loadTrainingPools", "buildTrainingRoute",
                      "trainingRouteScore", "data-training-toggle", "trainingRouteMaps"):
            self.assertIn(token, RANKED)

    def test_training_journal_is_wired(self):
        for element_id in ("trainingSessionFeel", "trainingSessionNote", "finishTrainingRoute",
                           "trainingJournalKpis", "trainingActivity14", "trainingExposure28",
                           "trainingJournalSummary", "trainingJournalList",
                           "importTrainingJournal", "exportTrainingJournal", "clearTrainingJournal"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("osl-training-history", "renderTrainingJournal", "archiveTrainingRoute",
                      "trainingSessionEvents", "suggestTrainingBand", "data-training-history-replay"):
            self.assertIn(token, RANKED)

    def test_training_insights_are_wired(self):
        for element_id in ("trainingInsightsPeriod", "copyTrainingInsights", "trainingInsightsKpis",
                           "trainingExposureCompare", "trainingSrBands", "trainingTargetMix",
                           "trainingFeelMix", "trainingInsightsSummary"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("trainingPeriodMetrics", "renderTrainingInsights",
                      "trainingInsightsReportText", "trainingMetricDelta"):
            self.assertIn(token, RANKED)

    def test_replay_signal_dashboard_is_wired(self):
        for element_id in ("retryReplayLinks", "exportReplaySignals", "clearReplaySignals",
                           "replaySignalKpis", "replayJudgementMix", "replayAccuracyBands",
                           "replayTimingSignals", "replayDnaSignals", "replaySignalSummary",
                           "replaySignalList"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("osl-replay-signals", "recordReplaySignal", "resolveReplayMapHash",
                      "renderReplaySignals", "window.OSLReplayBridge", "data-replay-route-complete"):
            self.assertIn(token, RANKED)
        self.assertIn("OSLReplayBridge?.record", HTML)

    def test_replay_trend_lab_is_wired(self):
        for element_id in ("importReplaySignals", "replayTrendMap", "replayTrendMods",
                           "replayTrendMetric", "replayTrendWindow", "replayTrendSummary",
                           "replayTrendChart", "replayPracticeCompare", "replayRepeatedSignals"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("renderReplayTrendLab", "renderReplayPracticeCompare",
                      "renderReplayRepeatedSignals", "firstTrainingCompletionByMap",
                      "replayModsLabel", "played_at_source"):
            self.assertIn(token, RANKED)

    def test_replay_profile_is_wired(self):
        for element_id in ("copyReplayProfile", "replayProfileKpis", "replayProfileVariability",
                           "replayProfileModCompare", "replayProfileEvidence", "replayProfileSignals"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("renderReplayProfile", "replayProfileEvidenceInfo", "replayProfileReportText",
                      "replayVariabilityBand", "replayStd", "replayNumeric"):
            self.assertIn(token, RANKED)
        self.assertIn('if(value==null||value==="")return NaN;', RANKED)

    def test_pc_replay_alignment_is_wired(self):
        for element_id in ("replayAlignmentSelect", "copyReplayAlignment", "replayAlignmentKpis",
                           "replayAlignmentSummary", "replayAlignmentRegions"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("buildReplayAlignment", "renderReplayAlignmentLab", "replayAlignmentSafe",
                      "data-replay-alignment", "tap-head-nearest-keydown-v1",
                      "DT/NC/HT 시간축 정렬은 아직 검증 전"):
            self.assertIn(token, RANKED)

    def test_repeat_region_consensus_is_wired(self):
        for element_id in ("copyReplayRepeatRegions", "replayRepeatWindow", "replayRepeatMin",
                           "replayRepeatRegionKpis", "replayRepeatRegionSummary",
                           "replayRepeatRegionList"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("replayRepeatRegionData", "renderReplayRepeatRegions",
                      "replayRepeatRegionReportText", "replayLongestPresence",
                      "top-candidate recurrence"):
            self.assertIn(token, RANKED)

    def test_region_fingerprint_is_wired(self):
        for element_id in ("replayFingerprintFilter", "replayFingerprintSummary"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("replayRegionFingerprint", "replayStoredFingerprint",
                      "replayAggregateFingerprints", "renderReplayFingerprintSummary",
                      "data-fingerprint-filter", "fingerprint-primary"):
            self.assertIn(token, RANKED)
        for label in ("Stream / Burst", "Jump", "Tech / Rhythm",
                      "Slider-heavy", "Dense / Reading", "Flow", "Mixed"):
            self.assertIn(label, RANKED)

    def test_failure_structure_profile_is_wired(self):
        for element_id in ("failureStructureScope", "failureStructureMinAlignments",
                           "copyFailureStructureProfile", "failureStructureKpis",
                           "failureStructureSummary", "failureStructureBars",
                           "failureStructureTable", "failureStructureExamples"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("failureStructureData", "renderFailureStructureProfile",
                      "failureStructureReportText", "data-failure-structure",
                      "2회 이상 다시 등장한"):
            self.assertIn(token, RANKED)

    def test_osl_client_bridge_is_wired(self):
        for element_id in ("clientModeKpi", "clientMapCount", "clientSetCount", "clientLastScanKpi",
                           "clientSongsPath", "clientAutoDetect", "clientSavePath", "clientScan",
                           "clientStatus", "clientScanProgress", "clientQuery", "clientSearch",
                           "clientResults"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', CLIENT)
        for token in ("/api/client/status", "/api/client/library", "/api/client/config",
                      "/api/client/scan", "/api/client/analyze", "OSLClientAcceptMap"):
            self.assertIn(token, CLIENT + HTML)
        self.assertIn('data-tab="client"', HTML)
        self.assertIn("M4 · BUILDING", HTML)

    def test_ranked_compare_workspace_is_wired(self):
        for element_id in ("compareTray", "compareTrayItems", "compareCount", "openCompare",
                           "compareNow", "clearCompare"):
            self.assertIn(f'id="{element_id}"', HTML)
            self.assertIn('$("' + element_id + '")', RANKED)
        for token in ("compareMaps", "data-compare-map", "showCompareMaps", "osl-ranked-compare"):
            self.assertIn(token, RANKED)

    def test_dna_overlay_is_lazy(self):
        self.assertIn("dnaOverlayCache", RANKED)
        self.assertIn("loadDnaOverlayYears", RANKED)
        self.assertIn("chart_dna?.shards", RANKED)

    def test_modal_controls_exist(self):
        self.assertIn('id="chartModal"', HTML)
        self.assertIn('id="chartModalClose"', HTML)
        self.assertIn('id="chartModalBody"', HTML)


if __name__ == "__main__":
    unittest.main()
