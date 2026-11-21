// Fixed words for the games: the Would You Rather prompts, and every fixed sentence the games can say out loud.
// Loaded with play.js (so api.play.phrases() can list every line without opening a game). No state, no DOM.
// Text style: plain, warm, no em dashes, no exclamation marks except real celebrations.

/** Would You Rather, road trip edition. Original and family friendly. "Would you rather <a> or <b>?" */
import { t } from "../i18n.js";
export const WYR = [
  // food stops
  [t("games.lines.eat_a_giant_burger_at_a_roadside_diner"), t("games.lines.share_a_mountain_of_fries_with")],
  [t("games.lines.have_a_milkshake_that_never_melts"), t("games.lines.have_a_bag_of_warm_pretzels_that_never")],
  [t("games.lines.eat_only_tacos_for_the_whole_trip"), t("games.lines.eat_only_pancakes_for_the_whole_trip")],
  [t("games.lines.pick_every_snack_stop_yourself"), t("games.lines.let_someone_else_pick_every_snack_stop")],
  [t("games.lines.eat_warm_cookies_at_every_rest_stop"), t("games.lines.eat_ice_cream_at_every_gas_station")],
  [t("games.lines.have_a_smoothie_with_every_fruit_in_it"), t("games.lines.have_a_milkshake_with_every_candy_in")],
  [t("games.lines.eat_a_sandwich_as_long_as_your_arm"), t("games.lines.eat_a_pizza_as_wide_as_the_back_seat")],
  [t("games.lines.have_dessert_before_every_meal"), t("games.lines.have_breakfast_for_dinner_every_night")],
  [t("games.lines.have_a_picnic_beside_a_river"), t("games.lines.have_a_picnic_at_the_top_of_a_mountain")],
  [t("games.lines.try_a_food_you_have_never_heard_of_at"), t("games.lines.get_your_favorite_food_at_every_stop")],
  [t("games.lines.eat_fries_that_taste_like_pizza"), t("games.lines.eat_popcorn_that_tastes_like_pancakes")],
  [t("games.lines.have_a_snack_drawer_in_the_car_that"), t("games.lines.have_a_snack_drawer_in_the_car_that_2")],
  [t("games.lines.sip_hot_chocolate_on_a_snowy_mountain"), t("games.lines.sip_lemonade_on_a_hot_summer_afternoon")],
  [t("games.lines.have_a_waiter_who_sings_your_order"), t("games.lines.have_a_waiter_who_brings_your_food_on")],
  [t("games.lines.eat_all_your_meals_standing_on_one"), t("games.lines.eat_all_your_meals_wearing_a_silly_hat")],
  [t("games.lines.eat_soup_with_a_fork"), t("games.lines.eat_spaghetti_with_a_spoon")],
  [t("games.lines.eat_a_giant_cinnamon_roll_for"), t("games.lines.eat_a_giant_stack_of_waffles_for")],
  [t("games.lines.have_a_lunch_stop_at_a_tiny_diner_with"), t("games.lines.have_a_lunch_stop_at_a_huge_market")],
  [t("games.lines.have_a_cold_drink_that_stays_cold_all"), t("games.lines.have_a_warm_snack_that_stays_warm_all")],
  [t("games.lines.have_every_meal_taste_like_your"), t("games.lines.have_every_snack_come_in_a_surprise")],
  // landscapes
  [t("games.lines.drive_past_a_snowy_mountain_every_day"), t("games.lines.drive_past_the_ocean_every_day")],
  [t("games.lines.see_a_field_of_wildflowers_that_goes"), t("games.lines.see_a_night_sky_full_of_stars_with_no")],
  [t("games.lines.wake_up_beside_a_quiet_lake"), t("games.lines.wake_up_in_a_forest_of_tall_trees")],
  [t("games.lines.drive_through_a_tunnel_made_of_trees"), t("games.lines.drive_across_a_bridge_made_of_glass")],
  [t("games.lines.stop_at_a_tall_waterfall"), t("games.lines.stop_at_a_huge_sand_dune")],
  [t("games.lines.spend_a_day_exploring_a_cave"), t("games.lines.spend_a_day_exploring_tide_pools")],
  [t("games.lines.see_a_whale_leap_out_of_the_sea"), t("games.lines.see_an_eagle_swoop_down_to_a_river")],
  [t("games.lines.ride_a_train_through_the_mountains"), t("games.lines.ride_a_boat_down_a_river")],
  [t("games.lines.watch_a_sunrise_over_the_hills"), t("games.lines.watch_a_sunset_over_the_ocean")],
  [t("games.lines.drive_in_fog_so_thick_it_feels_like_a"), t("games.lines.drive_in_sunshine_so_bright_you_need")],
  [t("games.lines.camp_under_one_huge_old_tree"), t("games.lines.camp_beside_a_bubbling_creek")],
  [t("games.lines.drive_past_an_orchard_that_goes_on"), t("games.lines.drive_past_a_field_of_sunflowers_that")],
  [t("games.lines.see_a_rainbow_every_time_it_rains"), t("games.lines.see_a_shooting_star_every_night")],
  [t("games.lines.visit_a_place_with_a_million_birds"), t("games.lines.visit_a_place_with_a_hundred_friendly")],
  [t("games.lines.hike_up_a_small_hill_and_see_for_miles"), t("games.lines.float_on_a_calm_lake_and_see_nothing")],
  [t("games.lines.drive_a_road_that_goes_up_and_down"), t("games.lines.drive_a_road_that_is_perfectly")],
  [t("games.lines.find_a_hidden_beach_that_nobody_else"), t("games.lines.find_a_hidden_waterfall_that_nobody")],
  [t("games.lines.see_a_huge_mountain_that_changes_color"), t("games.lines.see_a_huge_lake_that_is_perfectly")],
  // superpowers for long drives
  [t("games.lines.be_able_to_pause_traffic_for_one"), t("games.lines.be_able_to_turn_every_red_light_green")],
  [t("games.lines.have_a_car_that_can_float_across_water"), t("games.lines.have_a_car_that_can_glide_over_traffic")],
  [t("games.lines.make_every_bathroom_stop_take_only_one"), t("games.lines.make_every_gas_stop_come_with_a_free")],
  [t("games.lines.know_the_name_of_every_town_you_pass"), t("games.lines.know_a_fun_fact_about_every_sign_you")],
  [t("games.lines.have_a_car_that_sings_along_with_any"), t("games.lines.have_a_car_that_tells_a_story_whenever")],
  [t("games.lines.talk_to_any_animal_you_see_out_the"), t("games.lines.understand_every_bird_you_hear")],
  [t("games.lines.have_a_seat_that_is_always_perfectly"), t("games.lines.have_a_window_that_always_shows_the")],
  [t("games.lines.never_get_carsick"), t("games.lines.never_get_bored")],
  [t("games.lines.see_the_next_rest_stop_from_ten_miles"), t("games.lines.smell_the_next_bakery_from_ten_miles")],
  [t("games.lines.make_a_boring_hour_feel_like_one"), t("games.lines.make_the_best_part_of_the_day_last_for")],
  [t("games.lines.have_a_magic_map_that_always_finds_the"), t("games.lines.have_a_magic_compass_that_always")],
  [t("games.lines.have_a_pillow_that_fits_perfectly_in"), t("games.lines.have_a_blanket_that_is_always_the")],
  [t("games.lines.turn_the_car_into_a_boat_whenever_you"), t("games.lines.turn_the_car_into_a_tent_whenever_you")],
  [t("games.lines.have_a_button_that_plays_your_favorite"), t("games.lines.have_a_button_that_picks_the_perfect")],
  [t("games.lines.have_a_car_horn_that_plays_any_tune"), t("games.lines.have_windshield_wipers_that_wave_to")],
  [t("games.lines.magically_know_how_many_miles_are_left"), t("games.lines.magically_know_what_the_weather_will")],
  // silly
  [t("games.lines.have_a_pet_llama_who_rides_along"), t("games.lines.have_a_pet_penguin_who_rides_along")],
  [t("games.lines.talk_only_in_rhymes_for_an_hour"), t("games.lines.talk_only_in_whispers_for_an_hour")],
  [t("games.lines.wear_a_funny_hat_for_the_whole_trip"), t("games.lines.wear_giant_sunglasses_for_the_whole")],
  [t("games.lines.have_a_car_horn_that_moos"), t("games.lines.have_a_car_horn_that_quacks")],
  [t("games.lines.have_shoes_that_squeak_with_every_step"), t("games.lines.have_hair_that_changes_color_with")],
  [t("games.lines.give_every_cow_you_see_a_silly_name"), t("games.lines.give_every_truck_you_see_a_silly_name")],
  [t("games.lines.have_a_talking_map_that_tells_jokes"), t("games.lines.have_a_talking_map_that_tells_riddles")],
  [t("games.lines.be_in_charge_of_the_music_for_the"), t("games.lines.be_in_charge_of_the_map_for_the_whole")],
  [t("games.lines.have_a_rubber_duck_as_your_co_pilot"), t("games.lines.have_a_stuffed_bear_as_your_co_pilot")],
  [t("games.lines.find_a_treasure_map_in_the_glove_box"), t("games.lines.find_a_secret_snack_in_the_glove_box")],
  [t("games.lines.sing_every_song_in_a_funny_voice"), t("games.lines.sing_every_song_very_very_slowly")],
  [t("games.lines.have_a_car_that_smells_like_pancakes"), t("games.lines.have_a_car_that_smells_like_fresh_cut")],
  [t("games.lines.give_a_speech_about_your_favorite"), t("games.lines.act_out_your_favorite_movie_without")],
  [t("games.lines.talk_like_a_robot_for_ten_minutes"), t("games.lines.talk_like_a_pirate_for_ten_minutes")],
  [t("games.lines.have_a_car_with_a_glass_roof"), t("games.lines.have_a_car_with_a_roof_that_opens_like")],
  [t("games.lines.wear_socks_on_your_hands"), t("games.lines.wear_mittens_on_your_feet")],
  [t("games.lines.have_a_tail_that_wags_when_you_are"), t("games.lines.have_wings_that_are_too_small_to_fly")],
  [t("games.lines.invent_a_brand_new_road_sign"), t("games.lines.invent_a_brand_new_snack")],
  [t("games.lines.wave_at_every_truck_driver"), t("games.lines.count_every_red_car")],
  [t("games.lines.have_a_seat_that_spins_slowly"), t("games.lines.have_a_seat_that_bounces_gently")],
  // the trip itself
  [t("games.lines.sit_in_traffic_with_your_favorite"), t("games.lines.drive_on_an_empty_road_in_total")],
  [t("games.lines.take_the_slow_road_with_the_best_views"), t("games.lines.take_the_fast_road_with_nothing_to_see")],
  [t("games.lines.pack_one_giant_suitcase"), t("games.lines.pack_five_tiny_bags")],
  [t("games.lines.arrive_early_and_wait_around"), t("games.lines.arrive_late_after_seeing_something")],
  [t("games.lines.get_the_window_seat_all_trip"), t("games.lines.get_the_middle_seat_with_all_the")],
  [t("games.lines.play_road_games_all_day"), t("games.lines.listen_to_a_great_story_all_day")],
  [t("games.lines.take_a_long_trip_with_your_best_friend"), t("games.lines.take_a_short_trip_with_your_whole")],
  [t("games.lines.stop_at_every_interesting_sign_you_see"), t("games.lines.never_stop_until_you_reach_the_end")],
];

/** Fixed sentences the games say. Anything spoken that is not here is built from the app's own data (see phrases() in play.js). */
export const LINES = {
  right: t("games.lines.thats_right"),
  notQuite: t("games.lines.not_quite"),
  hol: { right: t("games.lines.thats_right"), wrong: t("games.lines.not_quite"), best: t("games.lines.a_new_best_streak") },
  plates: {
    rare: { HI: t("games.lines.hawaii_that_is_a_rare_find"), AK: t("games.lines.alaska_that_is_a_rare_find") },
    all: t("games.lines.that_is_all_fifty_states_and_d_c_every"),
  },
  hunt: { done: t("games.lines.you_found_everything_on_the_list_stamp") },
  alpha: { done: t("games.lines.you_made_it_from_a_to_z") },
  where: { good: t("games.lines.thats_right"), miss: t("games.lines.not_quite"), round: t("games.lines.that_is_the_round") },
  wyrLead: t("games.lines.would_you_rather"),
};
export const wyrSpeech = p => t("games.lines.wyrlead_x1_or_x2", { wyrLead: LINES.wyrLead, x1: p[0], x2: p[1] });
export const alphaSpeech = l => t("games.lines.find_a_word_that_starts_with_l", { l });

/** Tips for the hard letters. Spoken only when the person taps the speaker. */
export const ALPHA_TIPS = {
  Q: t("games.lines.q_is_a_tough_one_try_quick_quality"),
  X: t("games.lines.x_is_sneaky_the_word_exit_counts_and"),
  Z: t("games.lines.z_is_rare_try_zone_zero_zoo_or_zip"),
};
export const alphaTipSpeech = l => ALPHA_TIPS[l] || "";
