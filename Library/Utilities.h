/*
	Copyright(c) 2021-2025 jvde.github@gmail.com

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

#pragma once

#include <cstring>
#include <cassert>
#include <vector>
#include <time.h>
#include <iostream>
#include <fstream>
#include <mutex>
#include <string>
#include <array>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#else
#include <unistd.h>
#endif

#include "Stream.h"

struct TAG;
namespace AIS
{
	class Message;
}

namespace Util
{

	class RealPart : public SimpleStreamInOut<CFLOAT32, FLOAT32>
	{
		std::vector<FLOAT32> output;

	public:
		virtual ~RealPart() {}
		void Receive(const CFLOAT32 *data, int len, TAG &tag);
	};

	class ImaginaryPart : public SimpleStreamInOut<CFLOAT32, FLOAT32>
	{
		std::vector<FLOAT32> output;

	public:
		virtual ~ImaginaryPart() {}
		void Receive(const CFLOAT32 *data, int len, TAG &tag);
	};

	template <typename T>
	class PassThrough : public SimpleStreamInOut<T, T>
	{

	public:
		virtual ~PassThrough() {}
		virtual void Receive(const T *data, int len, TAG &tag) { SimpleStreamInOut<T, T>::Send(data, len, tag); }
		virtual void Receive(T *data, int len, TAG &tag) { SimpleStreamInOut<T, T>::Send(data, len, tag); }
	};

	template <typename T>
	class Timer : public SimpleStreamInOut<T, T>
	{

		high_resolution_clock::time_point time_start;
		float timing = 0.0;

		void tic()
		{
			time_start = high_resolution_clock::now();
		}

		void toc()
		{
			timing += 1e-3f * duration_cast<microseconds>(high_resolution_clock::now() - time_start).count();
		}

	public:
		virtual ~Timer() {}
		virtual void Receive(const T *data, int len, TAG &tag)
		{
			tic();
			SimpleStreamInOut<T, T>::Send(data, len, tag);
			toc();
		}
		virtual void Receive(T *data, int len, TAG &tag)
		{
			tic();
			SimpleStreamInOut<T, T>::Send(data, len, tag);
			toc();
		}

		float getTotalTiming() { return timing; }
	};

	class Convert
	{
	public:
		static std::string toTimeStr(const std::time_t &t);
		static std::string toTimestampStr(const std::time_t &t);
		static std::string toHexString(uint64_t l);
		static std::string toString(Format format);
		static std::string toString(bool b) { return b ? std::string("ON") : std::string("OFF"); }
		static std::string toString(bool b, FLOAT32 v) { return b ? std::string("AUTO") : std::to_string(v); }
		static std::string toString(FLOAT32 f)
		{
			std::string s = std::to_string(f);
			if (s == "nan" || s == "-nan")
				return "null";
			return s;
		}

		static std::string toString(PROTOCOL protocol);
		static std::string toString(MessageFormat out);

		static std::string BASE64toString(const std::string &s);
		static std::string IPV4toString(uint32_t ipv4)
		{
			return std::to_string((ipv4 >> 24) & 0xFF) + "." +
				   std::to_string((ipv4 >> 16) & 0xFF) + "." +
				   std::to_string((ipv4 >> 8) & 0xFF) + "." +
				   std::to_string(ipv4 & 0xFF);
		}

		static void toUpper(std::string &s);
		static void toLower(std::string &s);
		static void toFloat(CU8 *in, CFLOAT32 *out, int len);
		static void toFloat(CS8 *in, CFLOAT32 *out, int len);
		static void toFloat(CS16 *in, CFLOAT32 *out, int len);
	};

	class ConvertToRAW : public SimpleStreamInOut<CFLOAT32, RAW>
	{
	public:
		void Receive(const CFLOAT32 *data, int len, TAG &tag)
		{
			if (!out.isConnected())
				return;

			RAW rawOutput;
			rawOutput.format = Format::CF32;
			rawOutput.data = (void *)data;
			rawOutput.size = len * sizeof(CFLOAT32);

			Send(&rawOutput, 1, tag);
		}
	};

	class Parse
	{
	public:
		static long Integer(std::string str, long min = 0, long max = 0, const std::string &setting = "");
		static double Float(std::string str, double min = -1e30, double max = +1e30);
		static bool StreamFormat(std::string str, Format &format);
		static bool DeviceType(std::string str, Type &type);
		static bool Protocol(std::string str, PROTOCOL &protocol);
		static bool OutputFormat(std::string str, MessageFormat &out);
		static std::string DeviceTypeString(Type type);
		static std::time_t DateTime(const std::string &datetime);
		static bool Switch(std::string arg, const std::string &TrueString = "ON", const std::string &FalseString = "OFF");
		static bool AutoInteger(std::string arg, int min, int max, int &val);
		static bool AutoFloat(std::string arg, double min, double max, double &val);
		static void HTTP_URL(const std::string &url, std::string &protocol, std::string &host, std::string &port, std::string &path);
		static void URL(const std::string &url, std::string &protocol, std::string &username, std::string &password, std::string &host, std::string &port, std::string &path);
	};

	class Serialize
	{
	public:
		static void Uint8(uint8_t i, std::vector<char> &v);
		static void Uint16(uint16_t i, std::vector<char> &v);
		static void Uint32(uint32_t i, std::vector<char> &v);
		static void Uint64(uint64_t i, std::vector<char> &v);
		static void Int8(int8_t i, std::vector<char> &v);
		static void Int16(int16_t i, std::vector<char> &v);
		static void Int32(int32_t i, std::vector<char> &v);
		static void Int64(int64_t i, std::vector<char> &v);
		static void String(const std::string &s, std::vector<char> &v);
		static void LatLon(FLOAT32 lat, FLOAT32 lon, std::vector<char> &v);
		static void Float(FLOAT32 f, std::vector<char> &v);
		static void FloatLow(FLOAT32 f, std::vector<char> &v);
	};

	class Helper
	{
	public:
		static std::string readFile(const std::string &filename);
		static int lsb(uint64_t x);
		static std::vector<std::string> getFilesWithExtension(const std::string &directory, const std::string &extension);
		static long getMemoryConsumption();
		static std::string getOS();
		static std::string getHardware();
		static bool isUUID(const std::string &s)
		{
			if (s.size() != 36)
				return false;
			for (int i = 0; i < 36; i++)
			{
				if (i == 8 || i == 13 || i == 18 || i == 23)
				{
					if (s[i] != '-')
						return false;
				}
				else
				{
					if (!isxdigit(s[i]))
						return false;
				}
			}
			return true;
		}
	};

	class ConvertRAW : public SimpleStreamInOut<RAW, CFLOAT32>
	{
		std::vector<CFLOAT32> output;

	public:
		virtual ~ConvertRAW() {}
		Connection<CU8> outCU8;
		Connection<CS8> outCS8;

		void Receive(const RAW *raw, int len, TAG &tag);
	};

	class WriteWAV : public StreamIn<RAW>
	{
		struct WAVHeader
		{
			// RIFF Header
			char riff_header[4] = {'R', 'I', 'F', 'F'}; // Magic number "RIFF"
			uint32_t wav_size = 0;						// Total file size - 8
			char wave_header[4] = {'W', 'A', 'V', 'E'}; // Magic number "WAVE"

			// Format Chunk
			char fmt_header[4] = {'f', 'm', 't', ' '}; // Magic number "fmt "
			uint32_t fmt_chunk_size = 16;			   // Size of format chunk
			uint16_t audio_format = 1;				   // Format = PCM
			uint16_t num_channels = 2;				   // Stereo (I/Q)
			uint32_t sample_rate_val;				   // Sample rate
			uint32_t byte_rate;						   // SR * NumChannels * BitsPerSample/8
			uint16_t sample_alignment;				   // NumChannels * BitsPerSample/8
			uint16_t bit_depth;						   // Bits per sample

			// Data Chunk
			char data_header[4] = {'d', 'a', 't', 'a'}; // Magic number "data"
			uint32_t data_chunk_size = 0;				// Size of data
		} header;

		std::vector<CFLOAT32> output;
		std::ofstream file;
		std::string filename;
		Format format;
		int sample_rate = -1;
		bool stopping = false;

		void Open(const std::string &filename, int sample_rate);

	public:
		virtual ~WriteWAV();
		void Receive(const RAW *raw, int len, TAG &tag);

		bool setValue(std::string option, std::string arg);
	};

	class PackedInt
	{
	private:
		uint32_t value = 0;

	public:
		PackedInt() : value(0) {}
		PackedInt(int val) : value(val) {}

		inline int get(int position, int size) const
		{
			return (value >> position) & ((1 << size) - 1);
		}

		inline void set(int position, int size, int fieldValue)
		{
			value = (value & ~(((1 << size) - 1) << position)) | ((fieldValue & ((1 << size) - 1)) << position);
		}

		inline void andOp(int position, int size, int fieldValue)
		{
			value &= ((fieldValue & ((1 << size) - 1)) << position);
		}

		inline void orOp(int position, int size, int fieldValue)
		{
			value |= ((fieldValue & ((1 << size) - 1)) << position);
		}

		inline int getPackedValue() const
		{
			return value;
		}

		inline void setPackedValue(int val)
		{
			value = val;
		}

		inline void reset()
		{
			value = 0;
		}
	};

	class TemplateString
	{
		std::string tpl;

	public:
		TemplateString(const std::string &t) : tpl(t) {}
		void set(const std::string &t);
		std::string get(const TAG &tag, const AIS::Message &msg) const;
		std::string getTemplate() const
		{
			return tpl;
		}
		bool isTemplate() const
		{
			return tpl.find('%') != std::string::npos;
		}
	};
}
