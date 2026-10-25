# Headless build of the engine-independent flight-dynamics core (the same sources the Unreal module compiles).
cmake_minimum_required(VERSION 3.16)
project(SkyLineSimTests CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(SIM ${CMAKE_CURRENT_SOURCE_DIR}/../../Unreal/SkyLine/Source/SkyLineSim)
file(GLOB SIM_SOURCES ${SIM}/Private/*.cpp)
list(FILTER SIM_SOURCES EXCLUDE REGEX "SkyLineSimModule\\.cpp$")
add_executable(flight_tests flight_tests.cpp ${SIM_SOURCES})
target_include_directories(flight_tests PRIVATE ${SIM}/Public)
# -Wshadow mirrors Unreal's C4456/C4458 shadowing errors.
target_compile_options(flight_tests PRIVATE -O2 -Wall -Wextra -Wshadow -Werror)
